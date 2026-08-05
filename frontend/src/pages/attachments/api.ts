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
  formData.append('transaction_date', params.transaction_date);
  formData.append('amount', String(params.amount));
  formData.append('counterparty_name', params.counterparty_name);

  const { data } = await apiClient.post<{ success: true; data: Attachment; meta?: Meta }>(
    '/attachments',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  if (!data.data) throw new Error('証憑のアップロードに失敗しました');
  return data.data;
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
