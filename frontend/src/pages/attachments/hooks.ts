import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { fetchAttachmentContent, fetchAttachments, linkAttachment, uploadAttachment } from './api';
import type { AttachmentLinkableType, AttachmentListParams, AttachmentUploadParams } from './types';

const ATTACHMENTS_KEY = 'attachments';

export function useAttachments(params: AttachmentListParams) {
  return useQuery({
    queryKey: [ATTACHMENTS_KEY, 'list', params],
    queryFn: () => fetchAttachments(params),
  });
}

/** 証憑ファイル実体(blob)を取得する。ファイル内容は改ざん不可(追記専用)のため無期限にキャッシュしてよい */
export function useAttachmentContent(id: string | null) {
  return useQuery({
    queryKey: [ATTACHMENTS_KEY, 'content', id],
    queryFn: () => fetchAttachmentContent(id as string),
    enabled: id !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: AttachmentUploadParams) => uploadAttachment(params),
    onSuccess: (attachment) => {
      queryClient.invalidateQueries({ queryKey: [ATTACHMENTS_KEY] });
      toast.success(`証憑「${attachment.file_name}」をアップロードしました(SHA-256記録済み)`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useLinkAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      attachmentId,
      linkableType,
      linkableId,
    }: {
      attachmentId: string;
      linkableType: AttachmentLinkableType;
      linkableId: string;
    }) => linkAttachment(attachmentId, linkableType, linkableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ATTACHMENTS_KEY] });
      toast.success('業務レコードへ関連付けました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
