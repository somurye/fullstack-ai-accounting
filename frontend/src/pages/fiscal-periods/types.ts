export interface FiscalYear {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface FiscalPeriod {
  id: string;
  fiscal_year_id: string;
  period_no: number;
  start_date: string;
  end_date: string;
  status: string;
}
