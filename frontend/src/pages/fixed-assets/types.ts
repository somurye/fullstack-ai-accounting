import type { components } from '../../types/api.generated';

export type FixedAsset = components['schemas']['FixedAsset'];
export type FixedAssetCreate = components['schemas']['FixedAssetCreate'];
export type FixedAssetStatus = components['schemas']['FixedAssetStatus'];
export type DepreciationMethod = components['schemas']['DepreciationMethod'];
export type DepreciationSchedule = components['schemas']['DepreciationSchedule'];

export interface FixedAssetListParams {
  page?: number;
  page_size?: number;
  status?: FixedAssetStatus;
}

export const FIXED_ASSET_STATUS_LABEL: Record<FixedAssetStatus, string> = {
  active: '稼働中',
  disposed: '除却済み',
  sold: '売却済み',
};

export const DEPRECIATION_METHOD_LABEL: Record<DepreciationMethod, string> = {
  straight_line: '定額法',
  declining_balance: '定率法',
};
