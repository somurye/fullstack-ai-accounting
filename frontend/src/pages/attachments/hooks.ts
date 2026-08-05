import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { fetchAttachments, linkAttachment, uploadAttachment } from './api';
import type { AttachmentLinkableType, AttachmentListParams, AttachmentUploadParams } from './types';

const ATTACHMENTS_KEY = 'attachments';

export function useAttachments(params: AttachmentListParams) {
  return useQuery({
    queryKey: [ATTACHMENTS_KEY, 'list', params],
    queryFn: () => fetchAttachments(params),
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
