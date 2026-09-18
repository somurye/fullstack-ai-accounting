export interface ApprovalKpi {
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

export interface ContractKpi {
  active_contracts_count: number;
  expiring_soon_count: number;
  expiring_within_30_days: number;
  expiring_within_60_days: number;
}

export interface PurchaseKpi {
  pending_approval_count: number;
  pending_approval_amount: number;
  current_month_order_amount: number;
  pending_receipts_count: number;
}

export interface HrKpi {
  active_employees_count: number;
  unresolved_attendance_count: number;
  pending_attendance_approvals: number;
  overtime_alert_count: number;
}

export interface SalesKpi {
  open_deals_count: number;
  open_deals_amount: number;
  win_rate: number;
  quotation_conversion_rate: number;
  renewal_proposal_rate: number;
}

export interface ExecutiveDashboardSummary {
  approvals: ApprovalKpi | null;
  contracts: ContractKpi | null;
  purchase: PurchaseKpi | null;
  hr: HrKpi | null;
  sales: SalesKpi | null;
  available_domains: string[];
}
