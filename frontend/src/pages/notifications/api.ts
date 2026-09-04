import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';

export type Notification = components['schemas']['Notification'];

export interface NotificationListResult {
  items: Notification[];
  unread_count: number;
}

export async function fetchNotifications(params?: {
  status?: 'unread' | 'read';
  limit?: number;
  offset?: number;
}): Promise<NotificationListResult> {
  const { data } = await apiClient.get<{
    success: true;
    data: { items: Notification[]; unread_count: number };
  }>('/notifications', { params });
  return data.data ?? { items: [], unread_count: 0 };
}

export async function markNotificationAsRead(id: string): Promise<Notification> {
  const { data } = await apiClient.patch<{
    success: true;
    data: Notification;
  }>(`/notifications/${id}/read`);
  if (!data.data) throw new Error('通知の既読化に失敗しました');
  return data.data;
}
