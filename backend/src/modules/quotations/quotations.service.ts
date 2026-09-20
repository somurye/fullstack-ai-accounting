import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { QuotationPdfService } from './quotation-pdf.service';
import {
  mapQuotationRow,
  mapQuotationDetail,
  SQL_QUOTATION_COLUMNS,
  SQL_QUOTATION_LINE_COLUMNS,
  type QuotationDetailDto,
  type QuotationDto,
  type QuotationRow,
  type QuotationLineItemRow,
} from './quotations.mapper';
import type {
  CreateQuotationInput,
  QuotationListQuery,
  UpdateQuotationInput,
  ReviseQuotationInput,
} from './dto/quotation.schemas';

export interface QuotationListResult {
  quotations: QuotationDto[];
  pagination: PaginationMeta;
}

export async function generateQuoteNo(
  client: PoolClient,
  tenantId: string,
  year?: string,
): Promise<string> {
  const currentYear = year ?? new Date().getFullYear().toString();
  await acquireAdvisoryLock(client, `quote_no:${tenantId}:${currentYear}`);
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(DISTINCT quote_no)::text AS count FROM quotations WHERE tenant_id = $1 AND quote_no LIKE $2`,
    [tenantId, `QT-${currentYear}-%`],
  );
  const seq = Number(rows[0]?.count ?? 0) + 1;
  return `QT-${currentYear}-${String(seq).padStart(4, '0')}`;
}

async function generateInvoiceNo(
  client: PoolClient,
  tenantId: string,
  year?: string,
): Promise<string> {
  const currentYear = year ?? new Date().getFullYear().toString();
  await acquireAdvisoryLock(client, `invoice_no:${tenantId}:${currentYear}`);
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM invoices WHERE tenant_id = $1 AND invoice_no LIKE $2`,
    [tenantId, `INV-${currentYear}-%`],
  );
  const seq = Number(rows[0]?.count ?? 0) + 1;
  return `INV-${currentYear}-${String(seq).padStart(4, '0')}`;
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
    private readonly quotationPdfService: QuotationPdfService,
  ) {}

  /**
   * 見積一覧取得
   */
  async list(
    tenantId: string,
    userId: string,
    query: QuotationListQuery,
  ): Promise<QuotationListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['q.tenant_id = $1'];
    const params: (string | number)[] = [tenantId];
    let paramIndex = 2;

    if (query.status) {
      conditions.push(`q.status = $${paramIndex++}`);
      params.push(query.status);
    }

    if (query.customer_id) {
      conditions.push(`q.customer_id = $${paramIndex++}`);
      params.push(query.customer_id);
    }

    if (query.deal_id) {
      conditions.push(`q.deal_id = $${paramIndex++}`);
      params.push(query.deal_id);
    }

    if (query.from_date) {
      conditions.push(`q.issue_date >= $${paramIndex++}`);
      params.push(query.from_date);
    }

    if (query.to_date) {
      conditions.push(`q.issue_date <= $${paramIndex++}`);
      params.push(query.to_date);
    }

    if (query.search) {
      const searchPattern = `%${query.search}%`;
      conditions.push(
        `(q.quote_no ILIKE $${paramIndex} OR q.title ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex})`,
      );
      params.push(searchPattern);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*) AS total
      FROM quotations q
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE ${whereClause}
    `;

    const selectSql = `
      SELECT ${SQL_QUOTATION_COLUMNS}
      FROM quotations q
      LEFT JOIN customers c ON c.id = q.customer_id
      LEFT JOIN quotations sq ON sq.id = q.superseded_by
      LEFT JOIN invoices inv ON inv.id = q.converted_invoice_id
      LEFT JOIN users u ON u.id = q.created_by
      WHERE ${whereClause}
      ORDER BY q.created_at DESC, q.version DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    return this.db.transaction(tenantId, userId, async (client) => {
      const countRes = await client.query<{ total: string }>(countSql, params);
      const totalCount = Number(countRes.rows[0]?.total ?? 0);

      const selectParams = [...params, limit, offset];
      const res = await client.query<QuotationRow>(selectSql, selectParams);

      return {
        quotations: res.rows.map(mapQuotationRow),
        pagination: buildPagination(page, limit, totalCount),
      };
    });
  }

  /**
   * 見積詳細取得 (明細含む)
   */
  async findById(tenantId: string, userId: string, id: string): Promise<QuotationDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      return this.findByIdInternal(client, tenantId, id);
    });
  }

  /**
   * 見積作成 (draft)
   */
  async create(
    tenantId: string,
    userId: string,
    input: CreateQuotationInput,
  ): Promise<QuotationDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 顧客の存在・テナント所属確認
      const customerRes = await client.query<{ id: string }>(
        `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2`,
        [input.customer_id, tenantId],
      );
      if (customerRes.rows.length === 0) {
        throw AppException.badRequest('指定された顧客が存在しないか、権限がありません');
      }

      // 2. 見積番号採番
      const quoteNo = await generateQuoteNo(client, tenantId);

      // 3. 明細金額計算
      let subtotal = 0;
      let taxAmount = 0;
      const calculatedLines = input.lines.map((line, idx) => {
        const lineNo = idx + 1;
        const amount = Math.round(line.quantity * line.unit_price * 100) / 100;
        const lineTax = Math.round(amount * (line.tax_rate ?? 0.1) * 100) / 100;
        subtotal += amount;
        taxAmount += lineTax;
        return {
          ...line,
          line_no: lineNo,
          amount,
        };
      });

      // 4. quotations レコード作成
      const insertQuoteSql = `
        INSERT INTO quotations (
          tenant_id, customer_id, deal_id, quote_no, title, status,
          valid_until, issue_date, subtotal, tax_amount, currency_code,
          version, notes, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, 'draft',
          $6, COALESCE($7, CURRENT_DATE), $8, $9, 'JPY',
          1, $10, $11
        )
        RETURNING id
      `;
      const quoteInsertRes = await client.query<{ id: string }>(insertQuoteSql, [
        tenantId,
        input.customer_id,
        input.deal_id ?? null,
        quoteNo,
        input.title,
        input.valid_until ?? null,
        input.issue_date ?? null,
        subtotal,
        taxAmount,
        input.notes ?? null,
        userId,
      ]);
      const quotationId = quoteInsertRes.rows[0].id;

      // 5. quotation_line_items レコード作成
      for (const line of calculatedLines) {
        await client.query(
          `
          INSERT INTO quotation_line_items (
            tenant_id, quotation_id, line_no, item_name, description,
            quantity, unit, unit_price, amount, tax_rate, tax_category_id
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11
          )
          `,
          [
            tenantId,
            quotationId,
            line.line_no,
            line.item_name,
            line.description ?? null,
            line.quantity,
            line.unit || '式',
            line.unit_price,
            line.amount,
            line.tax_rate ?? 0.1,
            line.tax_category_id ?? null,
          ],
        );
      }

      // 6. 監査ログ記録
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.create',
        targetType: 'quotation',
        targetId: quotationId,
        afterData: { quoteNo, title: input.title, subtotal, taxAmount, totalAmount: subtotal + taxAmount },
      });

      return this.findByIdInternal(client, tenantId, quotationId);
    });
  }

  /**
   * 見積更新 (draft状態のみ)
   */
  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateQuotationInput,
  ): Promise<QuotationDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 対象レコード取得 (行ロック)
      const quoteRes = await client.query<QuotationRow>(
        `SELECT * FROM quotations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (quoteRes.rows.length === 0) {
        throw AppException.notFound('指定された見積書が見つかりません');
      }
      const existing = quoteRes.rows[0];

      if (existing.status !== 'draft') {
        throw AppException.badRequest(
          `ステータスが '${existing.status}' の見積書は直接編集できません。内容変更が必要な場合は改訂版(Revise)を発行してください`,
        );
      }

      // 2. 顧客IDが指定されている場合の所属確認
      if (input.customer_id && input.customer_id !== existing.customer_id) {
        const customerRes = await client.query<{ id: string }>(
          `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2`,
          [input.customer_id, tenantId],
        );
        if (customerRes.rows.length === 0) {
          throw AppException.badRequest('指定された顧客が存在しないか、権限がありません');
        }
      }

      // 3. 明細行の再計算と更新 (lines が指定されている場合)
      let subtotal = Number(existing.subtotal);
      let taxAmount = Number(existing.tax_amount);

      if (input.lines && input.lines.length > 0) {
        subtotal = 0;
        taxAmount = 0;
        const calculatedLines = input.lines.map((line, idx) => {
          const lineNo = idx + 1;
          const amount = Math.round(line.quantity * line.unit_price * 100) / 100;
          const lineTax = Math.round(amount * (line.tax_rate ?? 0.1) * 100) / 100;
          subtotal += amount;
          taxAmount += lineTax;
          return {
            ...line,
            line_no: lineNo,
            amount,
          };
        });

        // 既存明細削除
        await client.query(
          `DELETE FROM quotation_line_items WHERE quotation_id = $1 AND tenant_id = $2`,
          [id, tenantId],
        );

        // 新規明細挿入
        for (const line of calculatedLines) {
          await client.query(
            `
            INSERT INTO quotation_line_items (
              tenant_id, quotation_id, line_no, item_name, description,
              quantity, unit, unit_price, amount, tax_rate, tax_category_id
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11
            )
            `,
            [
              tenantId,
              id,
              line.line_no,
              line.item_name,
              line.description ?? null,
              line.quantity,
              line.unit || '式',
              line.unit_price,
              line.amount,
              line.tax_rate ?? 0.1,
              line.tax_category_id ?? null,
            ],
          );
        }
      }

      // 4. ヘッダ更新
      const updateSql = `
        UPDATE quotations
        SET
          customer_id = COALESCE($1, customer_id),
          deal_id = COALESCE($2, deal_id),
          title = COALESCE($3, title),
          valid_until = COALESCE($4, valid_until),
          issue_date = COALESCE($5, issue_date),
          notes = COALESCE($6, notes),
          subtotal = $7,
          tax_amount = $8,
          updated_at = now()
        WHERE id = $9 AND tenant_id = $10
      `;
      await client.query(updateSql, [
        input.customer_id ?? null,
        input.deal_id ?? null,
        input.title ?? null,
        input.valid_until ?? null,
        input.issue_date ?? null,
        input.notes !== undefined ? input.notes : null,
        subtotal,
        taxAmount,
        id,
        tenantId,
      ]);

      // 5. 監査ログ
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.update',
        targetType: 'quotation',
        targetId: id,
        afterData: { subtotal, taxAmount },
      });

      return this.findByIdInternal(client, tenantId, id);
    });
  }

  /**
   * 見積削除 (draft状態のみ)
   */
  async delete(tenantId: string, userId: string, id: string): Promise<void> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const quoteRes = await client.query<QuotationRow>(
        `SELECT quote_no, status FROM quotations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (quoteRes.rows.length === 0) {
        throw AppException.notFound('指定された見積書が見つかりません');
      }
      const existing = quoteRes.rows[0];
      if (existing.status !== 'draft') {
        throw AppException.badRequest('下書き(draft)状態の見積書のみ削除可能です');
      }

      await client.query(`DELETE FROM quotations WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.delete',
        targetType: 'quotation',
        targetId: id,
        beforeData: { quoteNo: existing.quote_no, status: existing.status },
      });
    });
  }

  /**
   * 見積確定送付 (draft -> sent)
   */
  async send(tenantId: string, userId: string, id: string): Promise<QuotationDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const quoteRes = await client.query<QuotationRow>(
        `SELECT * FROM quotations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (quoteRes.rows.length === 0) {
        throw AppException.notFound('指定された見積書が見つかりません');
      }
      const existing = quoteRes.rows[0];
      if (existing.status !== 'draft') {
        throw AppException.badRequest(`下書き(draft)状態の見積書のみ送付確定できます (現在: ${existing.status})`);
      }

      await client.query(
        `UPDATE quotations SET status = 'sent', updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.send',
        targetType: 'quotation',
        targetId: id,
        beforeData: { status: 'draft' },
        afterData: { status: 'sent' },
      });

      return this.findByIdInternal(client, tenantId, id);
    });
  }

  /**
   * 見積受注確定 (sent -> accepted)
   */
  async accept(tenantId: string, userId: string, id: string): Promise<QuotationDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const quoteRes = await client.query<QuotationRow>(
        `SELECT * FROM quotations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (quoteRes.rows.length === 0) {
        throw AppException.notFound('指定された見積書が見つかりません');
      }
      const existing = quoteRes.rows[0];
      if (existing.status !== 'sent') {
        throw AppException.badRequest(`提示済み(sent)状態の見積書のみ受注確定できます (現在: ${existing.status})`);
      }

      await client.query(
        `UPDATE quotations SET status = 'accepted', updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.accept',
        targetType: 'quotation',
        targetId: id,
        beforeData: { status: 'sent' },
        afterData: { status: 'accepted' },
      });

      return this.findByIdInternal(client, tenantId, id);
    });
  }

  /**
   * 見積失注・却下 (sent -> rejected)
   */
  async reject(tenantId: string, userId: string, id: string): Promise<QuotationDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const quoteRes = await client.query<QuotationRow>(
        `SELECT * FROM quotations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (quoteRes.rows.length === 0) {
        throw AppException.notFound('指定された見積書が見つかりません');
      }
      const existing = quoteRes.rows[0];
      if (existing.status !== 'sent') {
        throw AppException.badRequest(`提示済み(sent)状態の見積書のみ却下できます (現在: ${existing.status})`);
      }

      await client.query(
        `UPDATE quotations SET status = 'rejected', updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.reject',
        targetType: 'quotation',
        targetId: id,
        beforeData: { status: 'sent' },
        afterData: { status: 'rejected' },
      });

      return this.findByIdInternal(client, tenantId, id);
    });
  }

  /**
   * 見積改訂 (新バージョン発行: version++)
   * 元の見積は一切変更せず、superseded_by で新レコードをリンク
   */
  async revise(
    tenantId: string,
    userId: string,
    id: string,
    input: ReviseQuotationInput,
  ): Promise<QuotationDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 旧見積取得
      const quoteRes = await client.query<QuotationRow>(
        `SELECT * FROM quotations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (quoteRes.rows.length === 0) {
        throw AppException.notFound('指定された見積書が見つかりません');
      }
      const oldQuote = quoteRes.rows[0];

      if (oldQuote.status === 'draft') {
        throw AppException.badRequest('下書き状態の見積書は直接編集が可能です。改訂版発行は不要です');
      }

      if (oldQuote.superseded_by) {
        throw AppException.badRequest('この見積書は既に改訂版が発行されています');
      }

      // 2. 旧明細取得
      const lineRes = await client.query<QuotationLineItemRow>(
        `SELECT * FROM quotation_line_items WHERE quotation_id = $1 AND tenant_id = $2 ORDER BY line_no ASC`,
        [id, tenantId],
      );
      const oldLines = lineRes.rows;

      // 3. 新バージョン作成
      const newVersion = Number(oldQuote.version) + 1;
      const insertQuoteSql = `
        INSERT INTO quotations (
          tenant_id, customer_id, deal_id, quote_no, title, status,
          valid_until, issue_date, subtotal, tax_amount, currency_code,
          version, notes, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, 'draft',
          $6, CURRENT_DATE, $7, $8, $9,
          $10, $11, $12
        )
        RETURNING id
      `;
      const newQuoteRes = await client.query<{ id: string }>(insertQuoteSql, [
        tenantId,
        oldQuote.customer_id,
        oldQuote.deal_id,
        oldQuote.quote_no,
        oldQuote.title,
        oldQuote.valid_until,
        oldQuote.subtotal,
        oldQuote.tax_amount,
        oldQuote.currency_code,
        newVersion,
        input.notes ?? oldQuote.notes,
        userId,
      ]);
      const newQuoteId = newQuoteRes.rows[0].id;

      // 4. 明細コピー
      for (const line of oldLines) {
        await client.query(
          `
          INSERT INTO quotation_line_items (
            tenant_id, quotation_id, line_no, item_name, description,
            quantity, unit, unit_price, amount, tax_rate, tax_category_id
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11
          )
          `,
          [
            tenantId,
            newQuoteId,
            line.line_no,
            line.item_name,
            line.description,
            line.quantity,
            line.unit,
            line.unit_price,
            line.amount,
            line.tax_rate,
            line.tax_category_id,
          ],
        );
      }

      // 5. 旧見積の superseded_by を更新 (DBトリガーで superseded_by 列の更新は許可されている)
      await client.query(
        `UPDATE quotations SET superseded_by = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
        [newQuoteId, id, tenantId],
      );

      // 6. 監査ログ
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.revise',
        targetType: 'quotation',
        targetId: newQuoteId,
        beforeData: { originalQuoteId: id, version: oldQuote.version },
        afterData: { newQuoteId, version: newVersion },
      });

      return this.findByIdInternal(client, tenantId, newQuoteId);
    });
  }

  /**
   * 受注転換 (accepted -> 売上請求書 invoices 起票)
   */
  async convert(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ quotation: QuotationDetailDto; invoiceId: string; invoiceNo: string }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 対象見積取得 (FOR UPDATE)
      const quoteRes = await client.query<QuotationRow>(
        `SELECT * FROM quotations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (quoteRes.rows.length === 0) {
        throw AppException.notFound('指定された見積書が見つかりません');
      }
      const quote = quoteRes.rows[0];

      if (quote.status !== 'accepted' && quote.status !== 'sent') {
        throw AppException.badRequest(
          `提示済み(sent)または受注確定(accepted)状態の見積書のみ受注転換できます (現在: ${quote.status})`,
        );
      }

      if (quote.converted_invoice_id) {
        throw AppException.badRequest('この見積書は既に請求書に受注転換済みです (多重変換防止)');
      }

      // 2. 見積明細取得
      const lineRes = await client.query<QuotationLineItemRow>(
        `SELECT * FROM quotation_line_items WHERE quotation_id = $1 AND tenant_id = $2 ORDER BY line_no ASC`,
        [id, tenantId],
      );
      const lines = lineRes.rows;
      if (lines.length === 0) {
        throw AppException.badRequest('明細行が存在しない見積書は受注転換できません');
      }

      // 3. 請求書番号採番
      const invoiceNo = await generateInvoiceNo(client, tenantId);

      // 4. デフォルト売上高勘定科目および税区分の解決
      const accountRes = await client.query<{ id: string }>(
        `SELECT id FROM accounts WHERE tenant_id = $1 AND account_type = 'revenue' AND is_active = TRUE ORDER BY code ASC LIMIT 1`,
        [tenantId],
      );
      const defaultAccountId = accountRes.rows[0]?.id;
      if (!defaultAccountId) {
        throw AppException.badRequest('売上高勘定科目が設定されていないため請求書を作成できません');
      }

      const defaultTaxRes = await client.query<{ id: string }>(
        `SELECT id FROM tax_categories WHERE tenant_id = $1 AND is_active = TRUE ORDER BY code ASC LIMIT 1`,
        [quote.tenant_id],
      );
      let fallbackTaxCategoryId = defaultTaxRes.rows[0]?.id;
      if (!fallbackTaxCategoryId) {
        const createTaxRes = await client.query<{ id: string }>(
          `INSERT INTO tax_categories (tenant_id, code, name, tax_type, tax_rate, is_active)
           VALUES ($1, 'TAX10', '標準税率 10%', 'taxable', 10.00, TRUE)
           ON CONFLICT (tenant_id, code) DO UPDATE SET is_active = TRUE
           RETURNING id`,
          [quote.tenant_id],
        );
        fallbackTaxCategoryId = createTaxRes.rows[0].id;
      }

      // 5. 請求書 (invoices) レコード作成
      // 【設計判断 (P4-T1-FIX)】:
      // 見積の受注転換に伴い生成される請求書は必ず未確定の 'draft' 状態として起票される。
      // 見積の受注転換は商談成約に基づく「請求書の下書き起票」を意味し、請求確定・外部送付を
      // 自動的に行うものではない。既存の請求書発行フロー上の通常確認・確定操作を経て初めて
      // 正式な請求書となる。
      // また、tenant_id ($1) はクライアント入力ではなく、変換元見積の quote.tenant_id
      // (DBから直接取得した値) を強制的に導出してバインドする。
      const insertInvoiceSql = `
        INSERT INTO invoices (
          tenant_id, invoice_no, customer_id, issue_date, due_date,
          status, subtotal_amount, tax_amount, currency_code, created_by,
          source_quotation_id
        ) VALUES (
          $1, $2, $3, CURRENT_DATE, CURRENT_DATE + 30,
          'draft', $4, $5, $6, $7,
          $8
        )
        RETURNING id
      `;
      const invoiceInsertRes = await client.query<{ id: string }>(insertInvoiceSql, [
        quote.tenant_id, // 変換元見積の tenant_id をサーバ側で強制導出
        invoiceNo,
        quote.customer_id,
        quote.subtotal,
        quote.tax_amount,
        quote.currency_code || 'JPY',
        userId, // 認証済みセッション (JWT) 由来のユーザーID
        quote.id, // 変換元見積の id (source_quotation_id 双方向整合性)
      ]);
      const invoiceId = invoiceInsertRes.rows[0].id;

      // 6. 請求書明細 (invoice_lines) レコード作成
      // invoice_lines の tenant_id も変換元見積の quote.tenant_id を強制導出
      for (const line of lines) {
        await client.query(
          `
          INSERT INTO invoice_lines (
            tenant_id, invoice_id, line_no, description,
            quantity, unit_price, amount, tax_category_id, account_id
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9
          )
          `,
          [
            quote.tenant_id, // 変換元見積の tenant_id をサーバ側で強制導出
            invoiceId,
            line.line_no,
            line.item_name + (line.description ? ` (${line.description})` : ''),
            line.quantity,
            line.unit_price,
            line.amount,
            line.tax_category_id || fallbackTaxCategoryId,
            defaultAccountId,
          ],
        );
      }

      // 7. 見積書を更新 (status: 'accepted', converted_invoice_id セット)
      await client.query(
        `
        UPDATE quotations
        SET
          status = 'accepted',
          converted_invoice_id = $1,
          converted_at = now(),
          converted_by = $2,
          updated_at = now()
        WHERE id = $3 AND tenant_id = $4
        `,
        [invoiceId, userId, id, tenantId],
      );

      // 8. 監査ログ
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'quotation.convert',
        targetType: 'quotation',
        targetId: id,
        afterData: { invoiceId, invoiceNo },
      });

      const updatedQuotation = await this.findByIdInternal(client, tenantId, id);
      return {
        quotation: updatedQuotation,
        invoiceId,
        invoiceNo,
      };
    });
  }

  /**
   * PDFバイナリ取得
   */
  async getPdf(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const quotation = await this.findById(tenantId, userId, id);
    const buffer = await this.quotationPdfService.generatePdf(quotation);
    const filename = `quotation_${quotation.quote_no}_v${quotation.version}.pdf`;
    return { buffer, filename };
  }

  /**
   * 内部用詳細取得 (既存トランザクションクライアント利用)
   */
  private async findByIdInternal(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<QuotationDetailDto> {
    const quoteRes = await client.query<QuotationRow>(
      `
      SELECT ${SQL_QUOTATION_COLUMNS}
      FROM quotations q
      LEFT JOIN customers c ON c.id = q.customer_id
      LEFT JOIN quotations sq ON sq.id = q.superseded_by
      LEFT JOIN invoices inv ON inv.id = q.converted_invoice_id
      LEFT JOIN users u ON u.id = q.created_by
      WHERE q.id = $1 AND q.tenant_id = $2
      `,
      [id, tenantId],
    );

    if (quoteRes.rows.length === 0) {
      throw AppException.notFound('指定された見積書が見つかりません');
    }

    const lineRes = await client.query<QuotationLineItemRow>(
      `
      SELECT ${SQL_QUOTATION_LINE_COLUMNS}
      FROM quotation_line_items ql
      LEFT JOIN tax_categories tc ON tc.id = ql.tax_category_id
      WHERE ql.quotation_id = $1 AND ql.tenant_id = $2
      ORDER BY ql.line_no ASC
      `,
      [id, tenantId],
    );

    return mapQuotationDetail(quoteRes.rows[0], lineRes.rows);
  }

  /**
   * 送付後一定期間未回答のまま経過した見積一覧を取得する (P5-T2: レコメンドエンジン用)
   */
  async getStaleSentQuotations(
    tenantId: string,
    userId: string | null,
    daysThreshold = 14,
  ): Promise<
    Array<{
      id: string;
      quote_no: string;
      title: string;
      customer_id: string;
      deal_id: string | null;
      subtotal: number;
      tax_amount: number;
      total_amount: number;
      issue_date: string;
      days_since_issue: number;
    }>
  > {
    return this.db.transaction(tenantId, userId, async (client) => {
      const sql = `
        SELECT
          q.id,
          q.quote_no,
          q.title,
          q.customer_id,
          q.deal_id,
          q.subtotal::numeric AS subtotal,
          q.tax_amount::numeric AS tax_amount,
          (q.subtotal + q.tax_amount)::numeric AS total_amount,
          q.issue_date::text,
          GREATEST(0, (CURRENT_DATE - q.issue_date::date))::int AS days_since_issue
        FROM quotations q
        WHERE q.tenant_id = $1
          AND q.status = 'sent'
          AND q.converted_invoice_id IS NULL
          AND q.issue_date <= (CURRENT_DATE - ($2 || ' days')::interval)
        ORDER BY q.issue_date ASC
      `;
      const res = await client.query<{
        id: string;
        quote_no: string;
        title: string;
        customer_id: string;
        deal_id: string | null;
        subtotal: number;
        tax_amount: number;
        total_amount: number;
        issue_date: string;
        days_since_issue: number;
      }>(sql, [tenantId, daysThreshold]);

      return res.rows.map((row) => ({
        ...row,
        subtotal: Number(row.subtotal),
        tax_amount: Number(row.tax_amount),
        total_amount: Number(row.total_amount),
      }));
    });
  }
}

