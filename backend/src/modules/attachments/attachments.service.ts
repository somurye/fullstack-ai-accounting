import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  AttachmentLinkCreateInput,
  AttachmentListQuery,
  AttachmentUploadInput,
} from './dto/attachment.schemas';
import { ATTACHMENT_COLUMNS, mapAttachmentRow, type AttachmentDto, type AttachmentRow } from './attachments.mapper';

export interface AttachmentListResult {
  attachments: AttachmentDto[];
  pagination: PaginationMeta;
}

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

const STORAGE_ROOT = process.env.ATTACHMENTS_STORAGE_DIR ?? join(process.cwd(), 'uploads');

/**
 * AttachmentsService
 * ===================
 * 電帳法(電子帳簿保存法)対応の証憑ファイル管理。
 *
 * - アップロード時に `file_hash`(SHA-256)を自動算出して記録し、事後の改ざん検知を
 *   可能にする。
 * - `attachments`/`attachment_links` はいずれもDBトリガー(`fn_prevent_update_delete`)
 *   により物理削除・更新が禁止されている(追記専用)。openapi.yamlにも削除系
 *   エンドポイントは定義されていない。不備が見つかった証憑を「無効化」する場合は、
 *   物理削除やレコード書き換えではなく、`audit_logs` へ理由付きで追記する運用とする
 *   (証憑ファイル自体は電帳法の要求により保持し続ける必要があるため)。
 * - 検索(`GET /attachments`)は電帳法のスキャナ保存要件である
 *   「取引年月日・取引金額・取引先」の3項目での複合検索に対応する。
 *
 * ファイル実体はオブジェクトストレージ(S3等)を導入していないMVPのため、
 * バックエンドプロセスのローカルディスク(`ATTACHMENTS_STORAGE_DIR`、既定は
 * `<cwd>/uploads`)へ保存する。
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async upload(
    tenantId: string,
    userId: string,
    file: UploadedFileLike,
    dto: AttachmentUploadInput,
  ): Promise<AttachmentDto> {
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // `path.basename`でディレクトリ区切り(`../`等)を物理除去してからパス結合に用いる。
    // これを怠ると、細工されたoriginalname("../../etc/passwd"等)がテナント専用ディレクトリを
    // 脱出するパストラバーサルに悪用されうる。DBへ保存する表示用ファイル名も同じ値で統一する。
    const safeFileName = basename(file.originalname);

    const tenantDir = join(STORAGE_ROOT, tenantId);
    await mkdir(tenantDir, { recursive: true });
    const storedFileName = `${randomUUID()}_${safeFileName}`;
    const storagePath = join(tenantDir, storedFileName);
    await writeFile(storagePath, file.buffer);

    const documentCategory = dto.document_category ?? 'receipt';

    return this.db.transaction(tenantId, userId, async (client) => {
      const inserted = await client.query<AttachmentRow>(
        `INSERT INTO attachments
           (tenant_id, file_name, storage_path, mime_type, file_hash, document_category, transaction_date, amount, counterparty_name, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${ATTACHMENT_COLUMNS}`,
        [
          tenantId,
          safeFileName,
          storagePath,
          file.mimetype,
          fileHash,
          documentCategory,
          dto.transaction_date ?? null,
          dto.amount ?? null,
          dto.counterparty_name ?? null,
          userId,
        ],
      );
      const attachment = inserted.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'attachment.uploaded',
        targetType: 'attachment',
        targetId: attachment.id,
        afterData: {
          file_name: attachment.file_name,
          file_hash: attachment.file_hash,
          document_category: attachment.document_category,
          transaction_date: attachment.transaction_date,
          amount: attachment.amount,
          counterparty_name: attachment.counterparty_name,
        },
      });

      return mapAttachmentRow(attachment);
    });
  }

  async list(
    tenantId: string,
    userId: string | null,
    query: AttachmentListQuery,
  ): Promise<AttachmentListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.document_category) {
        params.push(query.document_category);
        conditions.push(`document_category = $${params.length}`);
      }
      if (query.transaction_date_from) {
        params.push(query.transaction_date_from);
        conditions.push(`transaction_date >= $${params.length}`);
      }
      if (query.transaction_date_to) {
        params.push(query.transaction_date_to);
        conditions.push(`transaction_date <= $${params.length}`);
      }
      if (query.amount !== undefined) {
        params.push(query.amount);
        conditions.push(`amount = $${params.length}`);
      }
      if (query.counterparty_name) {
        params.push(`%${query.counterparty_name}%`);
        conditions.push(`counterparty_name ILIKE $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM attachments WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<AttachmentRow>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM attachments
         WHERE ${whereClause}
         ORDER BY transaction_date DESC NULLS LAST, uploaded_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        attachments: result.rows.map(mapAttachmentRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<AttachmentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<AttachmentRow>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された添付ファイルが見つかりません');
      }
      return mapAttachmentRow(row);
    });
  }

  /**
   * `GET /attachments/:id/content` 用。テナント認可(RLS)を通過した上で、ディスク上の
   * 実ファイルパスとプレビュー表示に必要なメタデータのみを返す(証憑プレビュー/
   * インラインダウンロードは電帳法のスキャナ保存要件で求められる可視性確保のため)。
   */
  async getFileContent(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<{ storagePath: string; mimeType: string; fileName: string }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<{ storage_path: string; mime_type: string; file_name: string }>(
        `SELECT storage_path, mime_type, file_name FROM attachments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された添付ファイルが見つかりません');
      }
      return { storagePath: row.storage_path, mimeType: row.mime_type, fileName: row.file_name };
    });
  }

  async link(
    tenantId: string,
    userId: string,
    attachmentId: string,
    dto: AttachmentLinkCreateInput,
  ): Promise<void> {
    await this.db.transaction(tenantId, userId, async (client) => {
      const attachment = await client.query(
        `SELECT 1 FROM attachments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, attachmentId],
      );
      if (attachment.rowCount === 0) {
        throw AppException.notFound('指定された添付ファイルが見つかりません');
      }

      // UNIQUE (attachment_id, linkable_type, linkable_id) 違反はpg-error-mapperにより
      // 自動的に409 DUPLICATE_RECORDへ変換される(openapi.yamlの409仕様に対応)。
      await client.query(
        `INSERT INTO attachment_links (tenant_id, attachment_id, linkable_type, linkable_id)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, attachmentId, dto.linkable_type, dto.linkable_id],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'attachment.linked',
        targetType: dto.linkable_type,
        targetId: dto.linkable_id,
        afterData: { attachment_id: attachmentId },
      });
    });
  }
}
