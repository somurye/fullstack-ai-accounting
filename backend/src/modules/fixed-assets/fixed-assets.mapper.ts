import type { components } from '../../types/api.generated';

export type FixedAssetDto = components['schemas']['FixedAsset'];
export type DepreciationScheduleDto = components['schemas']['DepreciationSchedule'];

export interface FixedAssetRow {
  id: string;
  asset_no: string;
  name: string;
  category: string | null;
  acquisition_date: string;
  acquisition_cost: string;
  useful_life_years: number;
  depreciation_method: string;
  salvage_value: string;
  status: string;
  accumulated_depreciation: string;
  department_id: string | null;
  asset_account_id: string;
  depreciation_expense_account_id: string;
}

export interface DepreciationScheduleRow {
  id: string;
  fiscal_period_id: string;
  scheduled_amount: string;
  actual_amount: string | null;
  journal_entry_id: string | null;
  status: string;
}

export function mapDepreciationScheduleRow(row: DepreciationScheduleRow): DepreciationScheduleDto {
  return {
    id: row.id,
    fiscal_period_id: row.fiscal_period_id,
    scheduled_amount: Number(row.scheduled_amount),
    actual_amount: row.actual_amount !== null ? Number(row.actual_amount) : null,
    journal_entry_id: row.journal_entry_id,
    status: row.status as DepreciationScheduleDto['status'],
  };
}

export function mapFixedAssetRow(
  row: FixedAssetRow,
  schedules: DepreciationScheduleDto[],
): FixedAssetDto {
  return {
    id: row.id,
    asset_no: row.asset_no,
    name: row.name,
    category: row.category,
    acquisition_date: row.acquisition_date,
    acquisition_cost: Number(row.acquisition_cost),
    useful_life_years: row.useful_life_years,
    depreciation_method: row.depreciation_method as FixedAssetDto['depreciation_method'],
    salvage_value: Number(row.salvage_value),
    status: row.status as FixedAssetDto['status'],
    accumulated_depreciation: Number(row.accumulated_depreciation),
    department_id: row.department_id,
    asset_account_id: row.asset_account_id,
    depreciation_expense_account_id: row.depreciation_expense_account_id,
    depreciation_schedules: schedules,
  };
}

const FIXED_ASSET_COLUMNS = `
  id,
  asset_no,
  name,
  category,
  TO_CHAR(acquisition_date, 'YYYY-MM-DD') AS acquisition_date,
  acquisition_cost,
  useful_life_years,
  depreciation_method,
  salvage_value,
  status,
  accumulated_depreciation,
  department_id,
  asset_account_id,
  depreciation_expense_account_id
`;

const DEPRECIATION_SCHEDULE_COLUMNS = `
  id,
  fiscal_period_id,
  scheduled_amount,
  actual_amount,
  journal_entry_id,
  status
`;

export const SQL_COLUMNS = {
  fixedAsset: FIXED_ASSET_COLUMNS,
  depreciationSchedule: DEPRECIATION_SCHEDULE_COLUMNS,
};
