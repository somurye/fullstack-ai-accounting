import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import {
  generateZenginTransferFile,
  type ZenginSenderInfo,
  type ZenginTransferItem,
} from '../../common/zengin/zengin-format';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { ExportZenginInput, PaymentBatchListQuery } from './dto/payment-batch.schemas';
import {
  mapPaymentBatchItemRow,
  mapPaymentBatchRow,
  SQL_COLUMNS,
  type PaymentBatchDetailDto,
  type PaymentBatchDto,
  type PaymentBatchItemDto,
  type PaymentBatchItemRow,
  type PaymentBatchRow,
} from './payment-batches.mapper';

export interface PaymentBatchListResult {
  paymentBatches: PaymentBatchDto[];
  pagination: PaginationMeta;
}

interface ResolvedSourceItem {
  sourceType: 'vendor_bill' | 'expense_reimbursement';
  sourceId: string;
  payeeName: string;
  payeeBankInfo: Record<string, unknown>;
  amount: number;
}

function deriveConsignorCode(tenantId: string): string {
  const hex = tenantId.replace(/-/g, '').slice(0, 8);
  const num = parseInt(hex, 16) % 10_000_000_000;
  return String(num).padStart(10, '0');
}

@Injectable()
export class PaymentBatchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: PaymentBatchListQuery,
  ): Promise<PaymentBatchListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (query.status) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM payment_batches WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const batchesResult = await client.query<PaymentBatchRow>(
        `SELECT ${SQL_COLUMNS.paymentBatch}
         FROM payment_batches
         WHERE ${whereClause}
         ORDER BY payment_date DESC, batch_no DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      // 一覧では明細のプレビューは不要なため空配列とする(詳細取得時のみitemsを取得)。
      const paymentBatches = batchesResult.rows.map((row) => mapPaymentBatchRow(row, []));

      return {
        paymentBatches,
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<PaymentBatchDetailDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  /**
   * 支払対象(仕入請求書/経費立替金)を集計し、全銀協標準フォーマット(総合振込)のテキストデータを
   * 生成する。対象明細は生成時点でスナップショット化して `payment_batch_items` に固定保存する
   * (以後、元の仕入請求書/経費精算が変更されてもバッチ内容には影響しない)。
   *
   * 生成成功後は `status='exported'` へ更新する。以後は `trg_guard_payment_batch` トリガーにより
   * 物理削除・draftへの状態巻き戻しがDBレベルで禁止される。
   */
  async exportZengin(
    tenantId: string,
    userId: string,
    dto: ExportZenginInput,
  ): Promise<PaymentBatchDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const resolvedItems: ResolvedSourceItem[] = [];
      const vendorBillIds: string[] = [];
      const expenseReportIds: string[] = [];

      for (const source of dto.sources) {
        if (source.source_type === 'vendor_bill') {
          const item = await this.resolveVendorBillSource(client, tenantId, source.source_id);
          resolvedItems.push(item);
          vendorBillIds.push(source.source_id);
        } else if (source.source_type === 'expense_reimbursement') {
          const item = await this.resolveExpenseReimbursementSource(client, tenantId, source.source_id);
          resolvedItems.push(item);
          expenseReportIds.push(source.source_id);
        } else {
          // payroll: 給与データの銀行振込先はスキーマ上モデル化されておらず(payroll_import_linesに
          // 口座情報が存在しない)、本タスクのスコープ外のため明示的に未実装として拒否する。
          throw AppException.badRequest(
            'source_type=payroll からの支払バッチ生成は未実装です(給与明細に振込先口座情報が存在しません)',
          );
        }
      }

      const sender = await this.resolveSenderInfo(client, tenantId);
      const totalAmount = resolvedItems.reduce((sum, item) => sum + item.amount, 0);
      const batchNo = await this.generateBatchNo(client, tenantId, dto.payment_date);

      const batchInsert = await client.query<{ id: string }>(
        `INSERT INTO payment_batches
           (tenant_id, batch_no, payment_date, batch_type, status, total_amount, created_by)
         VALUES ($1, $2, $3, 'zengin_transfer', 'draft', $4, $5)
         RETURNING id`,
        [tenantId, batchNo, dto.payment_date, totalAmount, userId],
      );
      const batchId = batchInsert.rows[0].id;

      for (const item of resolvedItems) {
        await client.query(
          `INSERT INTO payment_batch_items
             (tenant_id, payment_batch_id, source_type, source_id, payee_name, payee_bank_info, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId,
            batchId,
            item.sourceType,
            item.sourceId,
            item.payeeName,
            JSON.stringify(item.payeeBankInfo),
            item.amount,
          ],
        );
      }

      const transferItems: ZenginTransferItem[] = resolvedItems.map((item) => ({
        bankCode: String(item.payeeBankInfo.bank_code ?? ''),
        bankName: String(item.payeeBankInfo.bank_name ?? ''),
        branchCode: String(item.payeeBankInfo.branch_code ?? ''),
        branchName: String(item.payeeBankInfo.branch_name ?? ''),
        accountType: String(item.payeeBankInfo.account_type ?? 'ordinary'),
        accountNumber: String(item.payeeBankInfo.account_number ?? ''),
        payeeName: item.payeeBankInfo.account_holder_kana
          ? String(item.payeeBankInfo.account_holder_kana)
          : item.payeeName,
        amount: item.amount,
      }));
      const zenginFile = generateZenginTransferFile(sender, dto.payment_date, transferItems);

      await client.query(
        `UPDATE payment_batches
         SET status = 'exported', file_hash = $3, exported_at = now(), exported_by = $4
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, batchId, zenginFile.sha256, userId],
      );

      if (vendorBillIds.length > 0) {
        await client.query(
          `UPDATE vendor_bills SET status = 'scheduled_for_payment'
           WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'approved'`,
          [tenantId, vendorBillIds],
        );
      }
      if (expenseReportIds.length > 0) {
        await client.query(
          `UPDATE expense_reports SET status = 'reimbursement_scheduled'
           WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'approved'`,
          [tenantId, expenseReportIds],
        );
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payment_batch.exported',
        targetType: 'payment_batch',
        targetId: batchId,
        afterData: { status: 'exported', total_amount: totalAmount, file_hash: zenginFile.sha256 },
      });

      const detail = await this.fetchDetail(client, tenantId, batchId);
      return { ...detail, download_url: `/v1/payment-batches/${batchId}/download` };
    });
  }

  /**
   * 全銀協テキストを再ダウンロードする。ファイル本体は保存せず、
   * 追記専用スナップショット(`payment_batches` ヘッダ + `payment_batch_items`)から
   * 決定論的に再生成する(送金元口座(bank_accounts)を編集するUIは本システムに存在しないため、
   * 生成時点と再生成時点で送金元情報が変わらないという前提が成立する)。
   */
  async downloadZenginFile(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<{ batchNo: string; content: string }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const batchResult = await client.query<PaymentBatchRow>(
        `SELECT ${SQL_COLUMNS.paymentBatch} FROM payment_batches WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const batchRow = batchResult.rows[0];
      if (!batchRow) {
        throw AppException.notFound('指定された支払バッチが見つかりません');
      }
      if (batchRow.status === 'draft') {
        throw AppException.conflict('CONFLICT', 'まだFBデータが生成されていません');
      }

      const itemsResult = await client.query<{
        payee_name: string;
        payee_bank_info: Record<string, unknown>;
        amount: string;
      }>(
        `SELECT payee_name, payee_bank_info, amount FROM payment_batch_items
         WHERE tenant_id = $1 AND payment_batch_id = $2 ORDER BY created_at ASC`,
        [tenantId, id],
      );

      const sender = await this.resolveSenderInfo(client, tenantId);
      const transferItems: ZenginTransferItem[] = itemsResult.rows.map((item) => ({
        bankCode: String(item.payee_bank_info.bank_code ?? ''),
        bankName: String(item.payee_bank_info.bank_name ?? ''),
        branchCode: String(item.payee_bank_info.branch_code ?? ''),
        branchName: String(item.payee_bank_info.branch_name ?? ''),
        accountType: String(item.payee_bank_info.account_type ?? 'ordinary'),
        accountNumber: String(item.payee_bank_info.account_number ?? ''),
        payeeName: item.payee_bank_info.account_holder_kana
          ? String(item.payee_bank_info.account_holder_kana)
          : item.payee_name,
        amount: Number(item.amount),
      }));

      const zenginFile = generateZenginTransferFile(sender, batchRow.payment_date, transferItems);
      return { batchNo: batchRow.batch_no, content: zenginFile.content };
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async fetchDetail(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<PaymentBatchDetailDto> {
    const batchResult = await client.query<PaymentBatchRow>(
      `SELECT ${SQL_COLUMNS.paymentBatch} FROM payment_batches WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const batchRow = batchResult.rows[0];
    if (!batchRow) {
      throw AppException.notFound('指定された支払バッチが見つかりません');
    }

    const itemsResult = await client.query<PaymentBatchItemRow>(
      `SELECT ${SQL_COLUMNS.paymentBatchItem} FROM payment_batch_items
       WHERE tenant_id = $1 AND payment_batch_id = $2 ORDER BY created_at ASC`,
      [tenantId, id],
    );
    const items: PaymentBatchItemDto[] = itemsResult.rows.map(mapPaymentBatchItemRow);

    return mapPaymentBatchRow(batchRow, items);
  }

  private async resolveVendorBillSource(
    client: PoolClient,
    tenantId: string,
    vendorBillId: string,
  ): Promise<ResolvedSourceItem> {
    const result = await client.query<{
      status: string;
      total_amount: string;
      vendor_name: string;
      vendor_kana_name: string | null;
      bank_account_info: Record<string, unknown> | null;
    }>(
      `SELECT vb.status, vb.total_amount, v.name AS vendor_name, v.kana_name AS vendor_kana_name, v.bank_account_info
       FROM vendor_bills vb
       JOIN vendors v ON v.id = vb.vendor_id AND v.tenant_id = vb.tenant_id
       WHERE vb.tenant_id = $1 AND vb.id = $2`,
      [tenantId, vendorBillId],
    );
    const row = result.rows[0];
    if (!row) {
      throw AppException.badRequest(`指定された仕入請求書(id: ${vendorBillId})が見つかりません`);
    }
    if (row.status !== 'approved') {
      throw AppException.conflict(
        'INVALID_STATE_TRANSITION',
        `仕入請求書(id: ${vendorBillId})は承認済み(approved)ではないため振込対象にできません`,
      );
    }
    if (!row.bank_account_info) {
      throw AppException.badRequest(
        `仕入先「${row.vendor_name}」に全銀FB振込先情報(bank_account_info)が登録されていません`,
      );
    }
    return {
      sourceType: 'vendor_bill',
      sourceId: vendorBillId,
      payeeName: row.vendor_kana_name ?? row.vendor_name,
      payeeBankInfo: row.bank_account_info,
      amount: Number(row.total_amount),
    };
  }

  private async resolveExpenseReimbursementSource(
    client: PoolClient,
    tenantId: string,
    expenseReportId: string,
  ): Promise<ResolvedSourceItem> {
    const result = await client.query<{ status: string; total_amount: string; employee_name: string }>(
      `SELECT er.status, er.total_amount, u.name AS employee_name
       FROM expense_reports er
       JOIN users u ON u.id = er.on_behalf_of
       WHERE er.tenant_id = $1 AND er.id = $2`,
      [tenantId, expenseReportId],
    );
    const row = result.rows[0];
    if (!row) {
      throw AppException.badRequest(`指定された経費精算申請(id: ${expenseReportId})が見つかりません`);
    }
    if (row.status !== 'approved') {
      throw AppException.conflict(
        'INVALID_STATE_TRANSITION',
        `経費精算申請(id: ${expenseReportId})は承認済み(approved)ではないため振込対象にできません`,
      );
    }
    // 従業員個人の全銀FB振込先口座はスキーマ上モデル化されていない(usersテーブルに
    // bank_account_info相当の列が存在しない)ため、MVPでは口座情報を空({})とする既知の制約。
    // 実運用では従業員マスタへの銀行口座情報追加が必要。
    return {
      sourceType: 'expense_reimbursement',
      sourceId: expenseReportId,
      payeeName: row.employee_name,
      payeeBankInfo: {},
      amount: Number(row.total_amount),
    };
  }

  private async resolveSenderInfo(client: PoolClient, tenantId: string): Promise<ZenginSenderInfo> {
    const tenantResult = await client.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
      tenantId,
    ]);
    const tenantName = tenantResult.rows[0]?.name ?? '';

    const bankAccountResult = await client.query<{
      bank_name: string;
      bank_code: string | null;
      branch_name: string | null;
      branch_code: string | null;
      account_type: string;
      account_number: string;
    }>(
      `SELECT bank_name, bank_code, branch_name, branch_code, account_type, account_number
       FROM bank_accounts WHERE tenant_id = $1 AND is_active = TRUE
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    const bankAccount = bankAccountResult.rows[0];
    if (!bankAccount) {
      throw AppException.badRequest(
        '振込元となる自社銀行口座(bank_accounts)が登録されていません。管理者に登録を依頼してください',
      );
    }

    return {
      consignorCode: deriveConsignorCode(tenantId),
      consignorName: tenantName,
      bankCode: bankAccount.bank_code ?? '',
      bankName: bankAccount.bank_name,
      branchCode: bankAccount.branch_code ?? '',
      branchName: bankAccount.branch_name ?? '',
      accountType: bankAccount.account_type,
      accountNumber: bankAccount.account_number,
    };
  }

  private async generateBatchNo(
    client: PoolClient,
    tenantId: string,
    paymentDate: string,
  ): Promise<string> {
    const datePart = paymentDate.replace(/-/g, '');
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM payment_batches WHERE tenant_id = $1 AND batch_no LIKE $2`,
      [tenantId, `PB-${datePart}-%`],
    );
    const seq = Number(rows[0]?.count ?? 0) + 1;
    return `PB-${datePart}-${String(seq).padStart(4, '0')}`;
  }
}
