import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { NotificationListQuery } from './dto/notification.schemas';

export interface NotificationRecord {
  id: string;
  tenant_id: string;
  type: string;
  target_type: string;
  target_id: string;
  title: string;
  body: string;
  status: 'unread' | 'read';
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * テナント内の通知一覧を取得する (RLS経由)。
   */
  async list(
    tenantId: string,
    query?: Partial<NotificationListQuery>,
  ): Promise<{ items: NotificationRecord[]; unread_count: number }> {
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;

    return this.db.transaction(tenantId, null, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query?.status) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      // 未読件数の取得 (フィルタ条件に関わらず常に全未読数をカウント)
      const countRes = await client.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM notifications WHERE tenant_id = $1 AND status = 'unread'`,
        [tenantId],
      );
      const unreadCount = countRes.rows[0]?.cnt ?? 0;

      // 一覧取得
      const limitParamIndex = params.length + 1;
      const offsetParamIndex = params.length + 2;
      params.push(limit, offset);

      const listRes = await client.query<NotificationRecord>(
        `SELECT
           id, tenant_id, type, target_type, target_id,
           title, body, status, read_at, created_at, updated_at
         FROM notifications
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
        params,
      );

      return {
        items: listRes.rows,
        unread_count: unreadCount,
      };
    });
  }

  /**
   * 指定した通知を既読化する。
   * 自テナント外の通知はRLSによって更新対象行が見つからず 404 となる。
   */
  async markAsRead(tenantId: string, id: string): Promise<NotificationRecord> {
    return this.db.transaction(tenantId, null, async (client) => {
      const { rows } = await client.query<NotificationRecord>(
        `UPDATE notifications
         SET status = 'read',
             read_at = now(),
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, tenant_id, type, target_type, target_id, title, body, status, read_at, created_at, updated_at`,
        [id, tenantId],
      );

      const notification = rows[0];
      if (!notification) {
        throw new NotFoundException(`通知が見つかりません (ID: ${id})`);
      }

      return notification;
    });
  }
}
