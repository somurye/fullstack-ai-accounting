import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  Attachment,
  AttachmentLinkableType,
  AttachmentListParams,
  AttachmentUploadParams,
} from './types';

type Meta = components['schemas']['Meta'];

export interface AttachmentListResult {
  attachments: Attachment[];
  meta: Meta | undefined;
}

export async function fetchAttachments(params: AttachmentListParams): Promise<AttachmentListResult> {
  const { data } = await apiClient.get<{ success: true; data: Attachment[]; meta?: Meta }>(
    '/attachments',
    { params },
  );
  return { attachments: data.data ?? [], meta: data.meta };
}

export async function uploadAttachment(params: AttachmentUploadParams): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', params.file);
  if (params.document_category) {
    formData.append('document_category', params.document_category);
  }
  if (params.transaction_date) {
    formData.append('transaction_date', params.transaction_date);
  }
  if (params.amount !== undefined) {
    formData.append('amount', String(params.amount));
  }
  if (params.counterparty_name) {
    formData.append('counterparty_name', params.counterparty_name);
  }

  const { data } = await apiClient.post<{ success: true; data: Attachment; meta?: Meta }>(
    '/attachments',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  if (!data.data) throw new Error('証憑のアップロードに失敗しました');
  return data.data;
}

/**
 * 証憑プレビュー用にファイル実体を取得する。`apiClient`のBearerトークン/
 * X-Tenant-IDヘッダーを通す必要があるため、`<img src="...">`への直接指定はできず、
 * blobとして取得してobject URLを生成する(呼び出し側で`URL.revokeObjectURL`必須)。
 */
export async function fetchAttachmentContent(id: string): Promise<{ blob: Blob; contentType: string }> {
  const response = await apiClient.get(`/attachments/${id}/content`, { responseType: 'blob' });
  const contentType = (response.headers['content-type'] as string | undefined) ?? 'application/octet-stream';
  return { blob: response.data as Blob, contentType };
}

export async function linkAttachment(
  attachmentId: string,
  linkableType: AttachmentLinkableType,
  linkableId: string,
): Promise<void> {
  await apiClient.post(`/attachments/${attachmentId}/links`, {
    linkable_type: linkableType,
    linkable_id: linkableId,
  });
}
