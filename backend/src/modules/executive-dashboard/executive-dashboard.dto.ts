/**
 * 承認ワークフローKPI DTO
 */
export interface ApprovalKpiDto {
  pending_total_count: number;
  pending_by_target: {
    contract: number;
    purchase_request: number;
    general_request: number;
    expense_report: number;
    journal_entry: number;
    payroll: number;
    [key: string]: number;
  };
}

/**
 * 契約・更新期限KPI DTO
 */
export interface ContractKpiDto {
  active_contracts_count: number;
  expiring_soon_count: number;
  expiring_within_30_days: number;
  expiring_within_60_days: number;
}

/**
 * 購買・稟議KPI DTO
 */
export interface PurchaseKpiDto {
  pending_approval_count: number;
  pending_approval_amount: number;
  current_month_order_amount: number;
  pending_receipts_count: number;
}

/**
 * 人事労務KPI DTO
 */
export interface HrKpiDto {
  active_employees_count: number;
  unresolved_attendance_count: number;
  pending_attendance_approvals: number;
  overtime_alert_count: number;
}

/**
 * 営業パイプラインKPI DTO
 */
export interface SalesKpiDto {
  open_deals_count: number;
  open_deals_amount: number;
  win_rate: number;
  quotation_conversion_rate: number;
  renewal_proposal_rate: number;
}

/**
 * 横断KPIエグゼクティブサマリー DTO
 * 閲覧権限がないドメインは null となり、集計値も一切返却されない (多層防御)
 */
export interface ExecutiveDashboardSummaryDto {
  approvals: ApprovalKpiDto | null;
  contracts: ContractKpiDto | null;
  purchase: PurchaseKpiDto | null;
  hr: HrKpiDto | null;
  sales: SalesKpiDto | null;
  available_domains: string[];
}
