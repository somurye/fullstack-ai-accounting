import { z } from 'zod';

export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const APPROVAL_TARGET_TYPES = ['journal_entry', 'expense_report', 'vendor_bill'] as const;

export const approvalRequestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(APPROVAL_REQUEST_STATUSES).optional(),
  target_type: z.enum(APPROVAL_TARGET_TYPES).optional(),
  pending_for_me: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ApprovalRequestListQuery = z.infer<typeof approvalRequestListQuerySchema>;

export const approvalRequestApproveSchema = z.object({
  comment: z.string().optional(),
});
export type ApprovalRequestApproveInput = z.infer<typeof approvalRequestApproveSchema>;

export const approvalRequestRejectSchema = z.object({
  comment: z.string().min(1, 'commentは必須です'),
});
export type ApprovalRequestRejectInput = z.infer<typeof approvalRequestRejectSchema>;
