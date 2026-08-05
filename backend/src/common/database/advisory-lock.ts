import type { PoolClient } from 'pg';

/**
 * トランザクションスコープのPostgreSQLアドバイザリロック(`pg_advisory_xact_lock`)を、
 * 任意の文字列キーで取得する。COMMIT/ROLLBACK時に自動的に解放されるため、
 * 明示的な解放処理は不要。
 *
 * 「素朴な`SELECT`で現在の状態を確認してから書き込む」だけのcheck-then-actパターンは、
 * 同一トランザクション内でRLSコンテキストを共有する`db.transaction()`の下でも
 * 複数の同時実行トランザクション間では競合しうる(READ COMMITTEDでは互いの
 * 未コミットの変更が見えないため)。採番やステータス排他等、「同じ対象への同時操作を
 * 直列化したい」箇所ではこのロックで確実に排他制御すること。
 */
export async function acquireAdvisoryLock(client: PoolClient, lockKey: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockKey]);
}
