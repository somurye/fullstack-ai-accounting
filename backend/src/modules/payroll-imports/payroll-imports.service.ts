import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { parseCsv } from '../../common/csv/parse-csv';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { generateJournalEntryNo } from '../../common/journal/generate-entry-no';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { PayrollImportCsvFields, PayrollImportListQuery } from './dto/payroll-import.schemas';
import {
  mapPayrollImportLineRow,
  mapPayrollImportRow,
  PAYROLL_IMPORT_COLUMNS,
  PAYROLL_IMPORT_LINE_COLUMNS,
  type PayrollImportDto,
  type PayrollImportLineDto,
  type PayrollImportLineRow,
  type PayrollImportRow,
} from './payroll-imports.mapper';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface PayrollImportListResult {
  imports: PayrollImportDto[];
  pagination: PaginationMeta;
}

interface MappingRow {
  id: string;
  column_mapping: Record<string, string | undefined>;
  account_mapping: Record<string, string | null | undefined>;
}

const ACCOUNTING_MANAGER_ROLE_CODE = 'accounting_manager';

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const normalized = raw.replace(/,/g, '').trim();
  if (normalized === '') return 0;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

/** 浮動小数点誤差を吸収するため、円単位の比較は四捨五入した整数で行う */
function round0(value: number): number {
  return Math.round(value);
}

/**
 * PayrollImportsService
 * ======================
 * `docs/openapi.yaml` `tags: [PayrollImports]` を実装する。
 *
 * `POST /payroll-imports/csv` は、給与ソフトCSVを取込マッピング(`payroll_import_mappings`)に
 * 従って解析し、従業員別明細(`payroll_import_lines`)と、役員報酬/給与手当/法定福利費(借方)・
 * 各種預り金/未払法定福利費/差引支給額(貸方)への複合仕訳(draft)を同一トランザクションで
 * 一括生成する。各金額は全従業員分を勘定科目単位で集約して1行にまとめる
 * (`vendor-bills`モジュールが消費税額を1行に集約するのと同じ設計判断)。
 *
 * 貸借は `payroll_import_lines` の CHECK制約
 * (`net_payment_amount = executive_compensation + salary - withholding_tax - resident_tax - social_insurance_employee`)
 * が従業員単位で保証しているため、全従業員分を合算した複合仕訳も構造上必ず貸借が一致する
 * (`social_insurance_company_amount` は借方の法定福利費・貸方の未払法定福利費の両方に
 * 同額計上されるため、差引には影響しない)。
 */
@Injectable()
export class PayrollImportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: PayrollImportListQuery,
  ): Promise<PayrollImportListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM payroll_imports WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const result = await client.query<PayrollImportRow>(
        `SELECT ${PAYROLL_IMPORT_COLUMNS} FROM payroll_imports
         WHERE tenant_id = $1
         ORDER BY payment_date DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, query.page_size, (query.page - 1) * query.page_size],
      );

      const linesByImportId = await this.fetchLinesForImports(
        client,
        tenantId,
        result.rows.map((row) => row.id),
      );
      const imports = result.rows.map((row) =>
        mapPayrollImportRow(row, linesByImportId.get(row.id) ?? []),
      );

      return { imports, pagination: buildPagination(query.page, query.page_size, totalCount) };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<PayrollImportDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  async importCsv(
    tenantId: string,
    userId: string,
    file: UploadedFileLike,
    fields: PayrollImportCsvFields,
  ): Promise<PayrollImportDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const mappingResult = await client.query<MappingRow>(
        `SELECT id, column_mapping, account_mapping FROM payroll_import_mappings
         WHERE tenant_id = $1 AND id = $2 AND is_active = TRUE`,
        [tenantId, fields.import_mapping_id],
      );
      if (mappingResult.rowCount === 0) {
        throw AppException.badRequest(
          '指定された給与CSV取込マッピング設定(import_mapping_id)が見つからないか、無効化されています',
        );
      }
      const mapping = mappingResult.rows[0];
      const columnMapping = mapping.column_mapping;
      const accountMapping = mapping.account_mapping;

      const records = parseCsv(file.buffer.toString('utf8'));
      if (records.length === 0) {
        throw AppException.badRequest('CSVファイルに取込可能な明細行がありません', [
          { message: 'ヘッダー行の後に1件以上の従業員明細行が必要です' },
        ]);
      }

      const employeeNameHeader = columnMapping.employee_name;
      if (!employeeNameHeader) {
        throw AppException.badRequest(
          '指定されたマッピング設定に employee_name の列対応が設定されていません',
        );
      }

      interface ParsedLine {
        employeeName: string;
        employeeCode: string | null;
        executiveCompensation: number;
        salary: number;
        withholdingTax: number;
        residentTax: number;
        socialInsuranceEmployee: number;
        socialInsuranceCompany: number;
        netPayment: number;
      }

      const parsedLines: ParsedLine[] = [];
      for (const record of records) {
        const employeeName = record[employeeNameHeader]?.trim();
        if (!employeeName) continue; // 空行・合計行等はスキップする

        const executiveCompensation = parseAmount(record[columnMapping.executive_compensation_amount ?? '']);
        const salary = parseAmount(record[columnMapping.salary_amount ?? '']);
        const withholdingTax = parseAmount(record[columnMapping.withholding_tax_amount ?? '']);
        const residentTax = parseAmount(record[columnMapping.resident_tax_amount ?? '']);
        const socialInsuranceEmployee = parseAmount(
          record[columnMapping.social_insurance_employee_amount ?? ''],
        );
        const socialInsuranceCompany = parseAmount(
          record[columnMapping.social_insurance_company_amount ?? ''],
        );
        const netPayment = parseAmount(record[columnMapping.net_payment_amount ?? '']);

        const expectedNetPayment = round0(
          executiveCompensation + salary - withholdingTax - residentTax - socialInsuranceEmployee,
        );
        if (round0(netPayment) !== expectedNetPayment) {
          throw AppException.badRequest(
            `従業員「${employeeName}」の差引支給額が計算値と一致しません` +
              `(CSV値: ${netPayment}, 計算値: ${expectedNetPayment} = 役員報酬+給料手当-源泉所得税-住民税-社会保険料(本人))`,
            [{ field: 'net_payment_amount', message: employeeName }],
          );
        }

        parsedLines.push({
          employeeName,
          employeeCode: columnMapping.employee_code ? record[columnMapping.employee_code] || null : null,
          executiveCompensation,
          salary,
          withholdingTax,
          residentTax,
          socialInsuranceEmployee,
          socialInsuranceCompany,
          netPayment,
        });
      }

      if (parsedLines.length === 0) {
        throw AppException.badRequest('CSVから有効な従業員明細を1件も読み取れませんでした');
      }

      const insertedImport = await client.query<{ id: string }>(
        `INSERT INTO payroll_imports
           (tenant_id, pay_period_start, pay_period_end, payment_date, import_mapping_id, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'imported', $6)
         RETURNING id`,
        [
          tenantId,
          fields.pay_period_start,
          fields.pay_period_end,
          fields.payment_date,
          mapping.id,
          userId,
        ],
      );
      const payrollImportId = insertedImport.rows[0].id;

      const lineDtos: PayrollImportLineDto[] = [];
      for (const line of parsedLines) {
        const lineResult = await client.query<PayrollImportLineRow>(
          `INSERT INTO payroll_import_lines
             (tenant_id, payroll_import_id, employee_name, employee_code,
              executive_compensation_amount, salary_amount, withholding_tax_amount, resident_tax_amount,
              social_insurance_employee_amount, social_insurance_company_amount, net_payment_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING ${PAYROLL_IMPORT_LINE_COLUMNS}`,
          [
            tenantId,
            payrollImportId,
            line.employeeName,
            line.employeeCode,
            line.executiveCompensation,
            line.salary,
            line.withholdingTax,
            line.residentTax,
            line.socialInsuranceEmployee,
            line.socialInsuranceCompany,
            line.netPayment,
          ],
        );
        lineDtos.push(mapPayrollImportLineRow(lineResult.rows[0]));
      }

      const journalEntryId = await this.buildCompoundJournalEntry(
        client,
        tenantId,
        userId,
        payrollImportId,
        fields.payment_date,
        accountMapping,
        parsedLines,
      );

      await client.query(`UPDATE payroll_imports SET journal_entry_id = $3 WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        payrollImportId,
        journalEntryId,
      ]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payroll_import.imported',
        targetType: 'payroll_import',
        targetId: payrollImportId,
        afterData: { journal_entry_id: journalEntryId, employee_count: parsedLines.length },
      });

      return this.fetchDetail(client, tenantId, payrollImportId);
    });
  }

  async post(tenantId: string, userId: string, id: string): Promise<PayrollImportDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const roleResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND r.code = $3`,
        [tenantId, userId, ACCOUNTING_MANAGER_ROLE_CODE],
      );
      if (Number(roleResult.rows[0]?.count ?? 0) === 0) {
        throw AppException.forbidden('給与仕訳の確定にはaccounting_managerロールが必要です');
      }

      const importResult = await client.query<{ status: string; journal_entry_id: string | null }>(
        `SELECT status, journal_entry_id FROM payroll_imports WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (importResult.rowCount === 0) {
        throw AppException.notFound('指定された給与インポートが見つかりません');
      }
      const record = importResult.rows[0];
      if (record.status !== 'imported') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', '取込直後(imported)の給与インポートのみ確定できます');
      }
      if (!record.journal_entry_id) {
        throw AppException.conflict('CONFLICT', 'この給与インポートには複合仕訳が紐付いていません');
      }

      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, record.journal_entry_id, userId],
      );
      await client.query(`UPDATE payroll_imports SET status = 'posted' WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
      ]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payroll_import.posted',
        targetType: 'payroll_import',
        targetId: id,
        afterData: { status: 'posted', journal_entry_id: record.journal_entry_id },
      });

      return this.fetchDetail(client, tenantId, id);
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async buildCompoundJournalEntry(
    client: PoolClient,
    tenantId: string,
    userId: string,
    payrollImportId: string,
    paymentDate: string,
    accountMapping: Record<string, string | null | undefined>,
    lines: Array<{
      executiveCompensation: number;
      salary: number;
      withholdingTax: number;
      residentTax: number;
      socialInsuranceEmployee: number;
      socialInsuranceCompany: number;
      netPayment: number;
    }>,
  ): Promise<string> {
    const totals = {
      executive_compensation_amount: 0,
      salary_amount: 0,
      withholding_tax_amount: 0,
      resident_tax_amount: 0,
      social_insurance_employee_amount: 0,
      social_insurance_company_amount: 0,
      net_payment_amount: 0,
    };
    for (const line of lines) {
      totals.executive_compensation_amount += line.executiveCompensation;
      totals.salary_amount += line.salary;
      totals.withholding_tax_amount += line.withholdingTax;
      totals.resident_tax_amount += line.residentTax;
      totals.social_insurance_employee_amount += line.socialInsuranceEmployee;
      totals.social_insurance_company_amount += line.socialInsuranceCompany;
      totals.net_payment_amount += line.netPayment;
    }

    const entryNo = await generateJournalEntryNo(client, tenantId, paymentDate);
    const jeInsert = await client.query<{ id: string }>(
      `INSERT INTO journal_entries
         (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
       VALUES ($1, $2, $3, $4, 'draft', 'payroll_import', $5, $6)
       RETURNING id`,
      [tenantId, entryNo, paymentDate, `給与支払: ${paymentDate}`, payrollImportId, userId],
    );
    const journalEntryId = jeInsert.rows[0].id;

    let lineNo = 1;
    const insertLine = async (accountId: string, debitCredit: 'debit' | 'credit', amount: number) => {
      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, journalEntryId, lineNo++, accountId, debitCredit, amount],
      );
    };

    // 借方: 役員報酬・給料手当・法定福利費(会社負担分)
    const debitPlan: Array<[keyof typeof totals, string]> = [
      ['executive_compensation_amount', 'executive_compensation_account_id'],
      ['salary_amount', 'salary_account_id'],
      ['social_insurance_company_amount', 'social_insurance_company_expense_account_id'],
    ];
    for (const [amountKey, accountKey] of debitPlan) {
      const amount = totals[amountKey];
      if (amount <= 0) continue;
      const accountId = accountMapping[accountKey];
      if (!accountId) {
        throw AppException.badRequest(
          `マッピング設定に ${accountKey} が設定されていないため、金額(${amount})を計上できません`,
        );
      }
      await insertLine(accountId, 'debit', amount);
    }

    // 貸方: 源泉所得税預り金・住民税預り金・社会保険料預り金(本人)・未払法定福利費(会社)・差引支給額
    const creditPlan: Array<[keyof typeof totals, string]> = [
      ['withholding_tax_amount', 'withholding_tax_account_id'],
      ['resident_tax_amount', 'resident_tax_account_id'],
      ['social_insurance_employee_amount', 'social_insurance_employee_account_id'],
      ['social_insurance_company_amount', 'social_insurance_company_payable_account_id'],
      ['net_payment_amount', 'net_payment_account_id'],
    ];
    for (const [amountKey, accountKey] of creditPlan) {
      const amount = totals[amountKey];
      if (amount <= 0) continue;
      const accountId = accountMapping[accountKey];
      if (!accountId) {
        throw AppException.badRequest(
          `マッピング設定に ${accountKey} が設定されていないため、金額(${amount})を計上できません`,
        );
      }
      await insertLine(accountId, 'credit', amount);
    }

    return journalEntryId;
  }

  private async fetchDetail(client: PoolClient, tenantId: string, id: string): Promise<PayrollImportDto> {
    const result = await client.query<PayrollImportRow>(
      `SELECT ${PAYROLL_IMPORT_COLUMNS} FROM payroll_imports WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) {
      throw AppException.notFound('指定された給与インポートが見つかりません');
    }

    const linesResult = await client.query<PayrollImportLineRow>(
      `SELECT ${PAYROLL_IMPORT_LINE_COLUMNS} FROM payroll_import_lines
       WHERE tenant_id = $1 AND payroll_import_id = $2
       ORDER BY employee_name ASC`,
      [tenantId, id],
    );

    return mapPayrollImportRow(row, linesResult.rows.map(mapPayrollImportLineRow));
  }

  private async fetchLinesForImports(
    client: PoolClient,
    tenantId: string,
    importIds: string[],
  ): Promise<Map<string, PayrollImportLineDto[]>> {
    const map = new Map<string, PayrollImportLineDto[]>();
    if (importIds.length === 0) return map;

    const result = await client.query<PayrollImportLineRow & { payroll_import_id: string }>(
      `SELECT payroll_import_id, ${PAYROLL_IMPORT_LINE_COLUMNS} FROM payroll_import_lines
       WHERE tenant_id = $1 AND payroll_import_id = ANY($2::uuid[])
       ORDER BY employee_name ASC`,
      [tenantId, importIds],
    );
    for (const row of result.rows) {
      const list = map.get(row.payroll_import_id) ?? [];
      list.push(mapPayrollImportLineRow(row));
      map.set(row.payroll_import_id, list);
    }
    return map;
  }
}
