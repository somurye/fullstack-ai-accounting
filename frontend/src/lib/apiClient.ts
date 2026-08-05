import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import type { components } from '../types/api.generated';

/** `docs/openapi.yaml` の共通エラーエンベロープ型 */
export type ApiErrorPayload = components['schemas']['ErrorResponse'];
export type ApiErrorDetail = components['schemas']['ApiError'];

// ----------------------------------------------------------------------------
// Idempotency-Key
// ----------------------------------------------------------------------------

/**
 * 副作用を伴うPOST操作(仕訳確定・請求書発行・支払バッチ生成・消込実行 等)に対して
 * 自動付与する冪等性キーを生成する。
 * `docs/openapi.yaml` の `Idempotency-Key` ヘッダー定義に対応する。
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 古いブラウザ等 crypto.randomUUID が使用できない環境向けのフォールバック。
  return `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Idempotency-Keyを自動付与する対象のHTTPメソッド(POSTのみ。PUT/PATCH/DELETEは元来冪等) */
const AUTO_IDEMPOTENT_METHODS = new Set(['post']);

// ----------------------------------------------------------------------------
// エラーハンドリング
// ----------------------------------------------------------------------------

/**
 * ApiClientError
 * ==============
 * axiosから投げられるあらゆるエラー(バックエンドの構造化エラー・
 * ネットワークエラー・タイムアウト・未知のエラー)を、UI側が一貫して
 * 扱えるように正規化した例外クラス。
 */
export class ApiClientError extends Error {
  /** `docs/openapi.yaml` のエラーコード (例: INVALID_BALANCE, TENANT_MISMATCH) */
  readonly code: string;
  readonly details: unknown[];
  readonly httpStatus: number | null;
  readonly requestId: string | null;

  constructor(params: {
    code: string;
    message: string;
    details?: unknown[];
    httpStatus?: number | null;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.code = params.code;
    this.details = params.details ?? [];
    this.httpStatus = params.httpStatus ?? null;
    this.requestId = params.requestId ?? null;
  }
}

interface ErrorResponseLike {
  success: false;
  error: { code: string; message: string; details?: unknown[] };
  meta?: { request_id?: string | null };
}

/** レスポンスボディがバックエンド標準のエラーエンベロープ形状かどうかを型安全に判定する */
function isApiErrorPayload(data: unknown): data is ErrorResponseLike {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  if (candidate.success !== false) return false;
  const error = candidate.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as Record<string, unknown>).code === 'string' &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/** axiosが投げた任意のエラーを、常に `ApiClientError` へ正規化する */
export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    const responseData = axiosError.response?.data;

    if (isApiErrorPayload(responseData)) {
      return new ApiClientError({
        code: responseData.error.code,
        message: responseData.error.message,
        details: responseData.error.details ?? [],
        httpStatus: axiosError.response?.status ?? null,
        requestId: responseData.meta?.request_id ?? null,
      });
    }

    if (axiosError.code === 'ECONNABORTED') {
      return new ApiClientError({
        code: 'TIMEOUT',
        message: 'リクエストがタイムアウトしました。時間をおいて再度お試しください',
        httpStatus: null,
      });
    }

    if (!axiosError.response) {
      return new ApiClientError({
        code: 'NETWORK_ERROR',
        message: 'サーバーに接続できませんでした。ネットワーク接続をご確認ください',
        httpStatus: null,
      });
    }

    return new ApiClientError({
      code: 'UNKNOWN_ERROR',
      message: axiosError.message || '不明なエラーが発生しました',
      httpStatus: axiosError.response.status,
    });
  }

  if (error instanceof Error) {
    return new ApiClientError({ code: 'UNKNOWN_ERROR', message: error.message, httpStatus: null });
  }

  return new ApiClientError({
    code: 'UNKNOWN_ERROR',
    message: '不明なエラーが発生しました',
    httpStatus: null,
  });
}

/** UI表示用(トースト通知等)の1行メッセージに整形するヘルパー */
export function formatApiErrorMessage(error: unknown): string {
  const apiError = toApiClientError(error);
  return apiError.message || `エラーが発生しました (${apiError.code})`;
}

// ----------------------------------------------------------------------------
// Axiosインスタンス
// ----------------------------------------------------------------------------

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/v1',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * リクエストインターセプター:
 *   - `Authorization: Bearer <accessToken>` を自動付与する。
 *   - `X-Tenant-ID` を現在選択中のテナントIDから自動付与する。
 *   - 副作用を伴うPOSTには `Idempotency-Key` を自動生成・付与する
 *     (呼び出し側が既に明示的に指定している場合はそれを優先する)。
 */
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken, currentTenantId } = useAuthStore.getState();

  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (currentTenantId) {
    config.headers.set('X-Tenant-ID', currentTenantId);
  }

  const method = config.method?.toLowerCase();
  if (method && AUTO_IDEMPOTENT_METHODS.has(method) && !config.headers.has('Idempotency-Key')) {
    config.headers.set('Idempotency-Key', generateIdempotencyKey());
  }

  return config;
});

/**
 * レスポンスインターセプター:
 *   - あらゆるエラーを `ApiClientError` に正規化してreject する。
 *   - 401 (UNAUTHORIZED) 受信時はセッションを破棄する
 *     (画面遷移(ログイン画面へのリダイレクト)はルーティング層の責務とする)。
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiClientError(error);

    if (apiError.httpStatus === 401) {
      useAuthStore.getState().logout();
    }

    return Promise.reject(apiError);
  },
);
