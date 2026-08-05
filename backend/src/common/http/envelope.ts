import { RequestContext } from '../context/request-context';

/**
 * PaginationMeta
 * `docs/openapi.yaml` の `Meta.pagination` に対応する。
 */
export interface PaginationMeta {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta: {
    request_id: string | null;
    pagination?: PaginationMeta;
  };
}

/**
 * `docs/openapi.yaml` の共通成功エンベロープ `{ success: true, data, meta }` を組み立てる。
 * `meta.request_id` は `RequestContext`(`TenantContextMiddleware` が生成)から取得する。
 */
export function successEnvelope<T>(data: T, pagination?: PaginationMeta): SuccessEnvelope<T> {
  return {
    success: true,
    data,
    meta: {
      request_id: RequestContext.getRequestId(),
      ...(pagination ? { pagination } : {}),
    },
  };
}

export function buildPagination(page: number, pageSize: number, totalCount: number): PaginationMeta {
  return {
    page,
    page_size: pageSize,
    total_count: totalCount,
    total_pages: pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0,
  };
}
