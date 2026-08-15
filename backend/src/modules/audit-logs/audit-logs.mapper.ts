import type { components } from '../../types/api.generated';

export type AuditLogDto = components['schemas']['AuditLog'];

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_user_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_name: string | null;
  before_data: unknown;
  after_data: unknown;
  ip_address: string | null;
  user_agent: string | null;
  occurred_at: Date;
}

export function mapAuditLogRow(row: AuditLogRow): AuditLogDto {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    actor_user_name: row.actor_user_name,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    target_name: row.target_name,
    before_data: row.before_data as AuditLogDto['before_data'],
    after_data: row.after_data as AuditLogDto['after_data'],
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    occurred_at: row.occurred_at.toISOString(),
  };
}

/**
 * `target_type` ごとに対応する業務テーブルから人間が読める名称(番号・氏名等)を
 * 解決するスカラーサブクエリ式。`CASE`は該当する1分岐のみ評価されるため、
 * 対象テーブル数が多くても実行コストは1クエリぶんで済む。
 *
 * 各分岐は `tenant_id = al.tenant_id` を明示条件に含めている(呼び出し元は
 * RLSにより同一テナントの行しか見えないため冗長ではあるが、意図を明確にする
 * ための多層防御)。未対応の`target_type`はNULLを返し、フロント側はその場合
 * `target_id` をそのまま表示する。
 */
const AUDIT_LOG_TARGET_NAME_EXPR = `
  CASE al.target_type
    WHEN 'journal_entry' THEN (
      SELECT je.entry_no FROM journal_entries je
      WHERE je.id = al.target_id AND je.tenant_id = al.tenant_id
    )
    WHEN 'expense_report' THEN (
      SELECT er.report_no FROM expense_reports er
      WHERE er.id = al.target_id AND er.tenant_id = al.tenant_id
    )
    WHEN 'invoice' THEN (
      SELECT inv.invoice_no FROM invoices inv
      WHERE inv.id = al.target_id AND inv.tenant_id = al.tenant_id
    )
    WHEN 'vendor_bill' THEN (
      SELECT vb.bill_no FROM vendor_bills vb
      WHERE vb.id = al.target_id AND vb.tenant_id = al.tenant_id
    )
    WHEN 'bank_transaction' THEN (
      SELECT COALESCE(bt.description, to_char(bt.transaction_date, 'YYYY-MM-DD')) FROM bank_transactions bt
      WHERE bt.id = al.target_id AND bt.tenant_id = al.tenant_id
    )
    WHEN 'bank_account' THEN (
      SELECT ba.bank_name || COALESCE(' ' || ba.branch_name, '') || '(' || ba.account_number || ')'
      FROM bank_accounts ba
      WHERE ba.id = al.target_id AND ba.tenant_id = al.tenant_id
    )
    WHEN 'payroll_import' THEN (
      SELECT to_char(pi.pay_period_start, 'YYYY-MM-DD') || '〜' || to_char(pi.pay_period_end, 'YYYY-MM-DD')
      FROM payroll_imports pi
      WHERE pi.id = al.target_id AND pi.tenant_id = al.tenant_id
    )
    WHEN 'fixed_asset' THEN (
      SELECT fa.name FROM fixed_assets fa
      WHERE fa.id = al.target_id AND fa.tenant_id = al.tenant_id
    )
    WHEN 'consumption_tax_return' THEN (
      SELECT to_char(fy.start_date, 'YYYY-MM-DD') || '〜' || to_char(fy.end_date, 'YYYY-MM-DD')
      FROM consumption_tax_returns ctr
      JOIN fiscal_years fy ON fy.id = ctr.fiscal_year_id
      WHERE ctr.id = al.target_id AND ctr.tenant_id = al.tenant_id
    )
    WHEN 'payment_batch' THEN (
      SELECT pb.batch_no FROM payment_batches pb
      WHERE pb.id = al.target_id AND pb.tenant_id = al.tenant_id
    )
    WHEN 'external_access_grant' THEN (
      SELECT u.name FROM external_access_grants eag
      JOIN users u ON u.id = eag.user_id
      WHERE eag.id = al.target_id AND eag.tenant_id = al.tenant_id
    )
    WHEN 'attachment' THEN (
      SELECT att.file_name FROM attachments att
      WHERE att.id = al.target_id AND att.tenant_id = al.tenant_id
    )
    WHEN 'tenant' THEN (
      SELECT t.name FROM tenants t WHERE t.id = al.target_id
    )
    WHEN 'user' THEN (
      SELECT u.name FROM users u
      WHERE u.id = al.target_id
        AND EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.user_id = u.id AND tu.tenant_id = al.tenant_id)
    )
    ELSE NULL
  END
`;

/**
 * `actor` は `users` への LEFT JOIN 別名(`audit-logs.service.ts`側で付与)。
 * `target_name` は `AUDIT_LOG_TARGET_NAME_EXPR` により `target_type` に応じて
 * 対応する業務テーブルから解決する(JOINではなくCASE内スカラーサブクエリのため、
 * 追加のJOIN別名は不要)。
 */
export const AUDIT_LOG_COLUMNS = `
  al.id,
  al.actor_user_id,
  actor.name AS actor_user_name,
  al.action,
  al.target_type,
  al.target_id,
  (${AUDIT_LOG_TARGET_NAME_EXPR}) AS target_name,
  al.before_data,
  al.after_data,
  al.ip_address::text AS ip_address,
  al.user_agent,
  al.occurred_at
`;
