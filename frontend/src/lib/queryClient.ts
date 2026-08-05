import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './apiClient';

/**
 * TanStack Query のグローバル設定。
 * ミューテーションはデフォルトでリトライしない
 * (仕訳確定・請求書発行等の副作用操作を誤って多重実行しないため。
 *  再送が必要な場合は `Idempotency-Key` により冪等性が保証される)。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // 認証・権限・入力値エラーはリトライしても解決しないため即座に諦める。
        if (error instanceof ApiClientError) {
          if (
            error.httpStatus !== null &&
            [400, 401, 403, 404, 409, 422].includes(error.httpStatus)
          ) {
            return false;
          }
        }
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
