import { z } from 'zod';

export const NOTIFICATION_STATUSES = ['unread', 'read'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const notificationListQuerySchema = z.object({
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
