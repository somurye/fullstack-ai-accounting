import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * `db.transaction()` に渡すコールバックの型。
 * トランザクション内で使用する `PoolClient` を受け取り、生SQLを直接実行する。
 */
export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

/**
 * DatabaseService
 * ================
 * ORMを使わず `pg`(node-postgres)の `Pool` による生SQL駆動でPostgreSQLへ接続する。
 *
 * 本サービスの最重要責務は、行レベルセキュリティ(RLS)のコンテキストである
 * `app.current_tenant_id` / `app.current_user_id` を、**トランザクションの範囲内でのみ**
 * 安全に設定・破棄することである(sql/001_initial_schema_all_in_one.sql の
 * `fn_current_tenant_id()` / `fn_current_user_id()` および全RLSポリシーが参照する)。
 *
 * 【重要な実装上の注意】
 * `SET LOCAL app.current_tenant_id = $1` のようにプレースホルダを直接埋め込む構文は
 * 使用できない。`SET` はユーティリティコマンドであり、拡張問い合わせプロトコルの
 * バインドパラメータを受け付けないため、実行時に構文エラーとなる
 * (`syntax error at or near "$1"`)。
 *
 * かわりに、通常の関数呼び出しとして安全にパラメータ化できる
 * `set_config(setting_name, new_value, is_local)` を使用する。
 * 第3引数 `is_local = true` を渡すことで `SET LOCAL` と同じ挙動になり、
 * トランザクション終了(COMMIT/ROLLBACK)時に自動的に値がリセットされる。
 * これによりコネクションプーリング環境下でテナントIDが次のリクエストへ
 * 漏れ出すことを防ぐ(RLS設計書 docs/03_database_design.md 6.2 参照)。
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  public readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      max: process.env.PG_POOL_MAX ? Number(process.env.PG_POOL_MAX) : 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    // アイドル状態のクライアントで発生した非同期エラー(コネクション切断等)を
    // 必ず捕捉する。捕捉しないとNodeプロセスがクラッシュする(pgドライバの既知の挙動)。
    this.pool.on('error', (err: Error) => {
      this.logger.error(`Unexpected error on idle PostgreSQL client: ${err.message}`, err.stack);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * RLSコンテキスト(テナントID・ユーザーID)を設定した1トランザクション内で
   * callbackを実行する。
   *
   * - callbackが正常終了すれば `COMMIT`、例外を投げれば `ROLLBACK` する。
   * - `tenantId` / `userId` が `null` の場合はコンテキストを設定しない
   *   (RLSはfail-closed設計のため、テナント固有テーブルへの問い合わせは
   *    自動的に0件を返す。バッチ処理等、意図的にシステムロールとして
   *    動作させたい場合を除き、通常のAPIリクエストでは必ず両方を渡すこと)。
   * - DBトリガー/CHECK制約違反(貸借不一致・追記専用違反・自己承認禁止等)は
   *   `pg` の `DatabaseError` としてそのままcallbackから再スローされ、
   *   `HttpExceptionFilter` 側で `ErrorResponse` 形式に変換される。
   *
   * @example
   * ```ts
   * const entry = await db.transaction(tenantId, userId, async (client) => {
   *   const { rows } = await client.query(
   *     `INSERT INTO journal_entries (tenant_id, entry_no, entry_date, created_by)
   *      VALUES ($1, $2, $3, $4) RETURNING *`,
   *     [tenantId, entryNo, entryDate, userId],
   *   );
   *   return rows[0];
   * });
   * ```
   */
  async transaction<T>(
    tenantId: string | null,
    userId: string | null,
    callback: TransactionCallback<T>,
  ): Promise<T> {
    return this.runWithDeadlockRetry(() => this.runTransaction(tenantId, userId, callback));
  }

  private async runTransaction<T>(
    tenantId: string | null,
    userId: string | null,
    callback: TransactionCallback<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (tenantId) {
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
      }
      if (userId) {
        await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
      }

      const result = await callback(client);

      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error(
          'Failed to rollback transaction after an error',
          (rollbackErr as Error).stack,
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * デッドロック(PostgreSQLエラーコード `40P01`)は、行ロック(FK参照時のFOR KEY SHARE等)と
   * アドバイザリロック(採番等)を組み合わせて使う本アプリの設計上、複数リクエストが同時に
   * 同じ勘定科目・同じ日付キーへ集中すると一定確率で発生しうる、正常系の一部として
   * 想定すべき一時的な事象である(片方のトランザクションが必ず犠牲になりROLLBACKされることで
   * 系全体としては前進する、PostgreSQL自身のデッドロック検出・解消の仕組み)。
   * 呼び出し側で毎回リトライ処理を書かせるのではなく、`transaction()`/`transactionAsRole()`の
   * 共通境界で少数回まで自動リトライすることで、書き込みが集中するAPI
   * (経費申請の一斉提出等)がユーザーに素の500エラーを返さないようにする。
   */
  private async runWithDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await run();
      } catch (err) {
        const isDeadlock = (err as { code?: string } | null)?.code === '40P01';
        if (!isDeadlock || attempt === MAX_ATTEMPTS) {
          throw err;
        }
        this.logger.warn(`Deadlock detected, retrying transaction (attempt ${attempt}/${MAX_ATTEMPTS})`);
        const backoffMs = 20 * attempt + Math.floor(Math.random() * 30);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    // 到達しない(ループ内で必ずreturnまたはthrow)が、TypeScriptの制御フロー解析用。
    throw new Error('unreachable');
  }

  /**
   * 特定のDBロール(`app_readonly_external` 等)としてRLSコンテキストを設定した
   * 読み取り専用トランザクションを実行する。税理士・監査人向けAPIなど、
   * `SET LOCAL ROLE` の切替が必要な場合に使用する。
   */
  async transactionAsRole<T>(
    role: string,
    tenantId: string | null,
    userId: string | null,
    callback: TransactionCallback<T>,
  ): Promise<T> {
    return this.runWithDeadlockRetry(() => this.runTransactionAsRole(role, tenantId, userId, callback));
  }

  private async runTransactionAsRole<T>(
    role: string,
    tenantId: string | null,
    userId: string | null,
    callback: TransactionCallback<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // ロール名はプレースホルダ化できないため、英数字・アンダースコアのみを
      // 許容する厳格なバリデーションを行い、SQLインジェクションを防止する。
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role)) {
        throw new Error(`Invalid database role name: ${role}`);
      }
      await client.query(`SET LOCAL ROLE ${role}`);

      if (tenantId) {
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
      }
      if (userId) {
        await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
      }

      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error(
          'Failed to rollback transaction after an error',
          (rollbackErr as Error).stack,
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * RLSコンテキストを必要としない問い合わせ用の低レベルエスケープハッチ。
   *
   * 使用は限定的なケース(ヘルスチェック、テナントを跨がないシステムマスタの参照等)
   * に留めること。テナント固有テーブルに対して使用すると、RLSのfail-closed設計により
   * 常に0件が返る(意図しないバグに見えるが、これは仕様通りの安全側動作である)。
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }
}
