import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 1リクエストのライフサイクル全体で共有されるコンテキスト情報。
 * `TenantContextMiddleware` が生成し、`TenantAuthGuard` がJWT検証後に
 * `userId` を書き込む(同一オブジェクト参照をミューテートするため、
 * ミドルウェア以降のどの非同期処理からでも一貫して参照・更新できる)。
 */
export interface RequestContextStore {
  /** X-Tenant-IDヘッダーの値(未検証。認可済みの値は`TenantAuthGuard`通過後に保証される) */
  tenantId: string | null;
  /** JWT検証後に設定されるログインユーザーID */
  userId: string | null;
  /** リクエスト追跡用ID。ログ相関・エラーレスポンスのmeta.request_idに使用する */
  requestId: string;
  /** クライアントIPアドレス(`audit_logs.ip_address`用)。ミドルウェアが`req.ip`から設定する */
  ipAddress: string | null;
}

/**
 * RequestContext
 * ==============
 * `AsyncLocalStorage` を用いて、Expressのリクエストオブジェクトをバケツリレー的に
 * 引き回すことなく、サービス層/リポジトリ層からテナントID・ユーザーIDを
 * 参照できるようにするユーティリティ。
 *
 * `DatabaseService.transaction()` を呼び出す各サービスは、通常
 * `RequestContext.getTenantId()` / `RequestContext.getUserId()` の値を
 * そのまま渡す。
 */
export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  /** 新しいコンテキストを生成し、そのスコープ内でcallbackを実行する(通常はミドルウェアのみが呼ぶ) */
  static run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  /** 現在のコンテキストを取得する。リクエストスコープ外(起動処理等)で呼ぶとundefinedを返す */
  static getStore(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  static getTenantId(): string | null {
    return this.storage.getStore()?.tenantId ?? null;
  }

  static getUserId(): string | null {
    return this.storage.getStore()?.userId ?? null;
  }

  static getRequestId(): string | null {
    return this.storage.getStore()?.requestId ?? null;
  }

  static getIpAddress(): string | null {
    return this.storage.getStore()?.ipAddress ?? null;
  }

  /** `TenantAuthGuard` がJWT検証成功後に呼び出し、認可済みユーザーIDを反映する */
  static setUserId(userId: string): void {
    const store = this.storage.getStore();
    if (store) {
      store.userId = userId;
    }
  }

  /**
   * `TenantAuthGuard` がJWTクレームの`tenant_id`で上書きし、
   * ヘッダー由来の未検証値を認可済みの値に置き換える。
   */
  static setTenantId(tenantId: string): void {
    const store = this.storage.getStore();
    if (store) {
      store.tenantId = tenantId;
    }
  }
}
