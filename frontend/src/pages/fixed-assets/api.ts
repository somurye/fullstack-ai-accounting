import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { FixedAsset, FixedAssetCreate, FixedAssetListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface FixedAssetListResult {
  fixedAssets: FixedAsset[];
  meta: Meta | undefined;
}

export interface DepreciationRunResult {
  processed_count: number;
  journal_entry_ids: string[];
}

export async function fetchFixedAssets(params: FixedAssetListParams): Promise<FixedAssetListResult> {
  const { data } = await apiClient.get<{ success: true; data: FixedAsset[]; meta?: Meta }>(
    '/fixed-assets',
    { params },
  );
  return { fixedAssets: data.data ?? [], meta: data.meta };
}

export async function fetchFixedAsset(id: string): Promise<FixedAsset> {
  const { data } = await apiClient.get<{ success: true; data: FixedAsset; meta?: Meta }>(
    `/fixed-assets/${id}`,
  );
  if (!data.data) throw new Error('固定資産データを取得できませんでした');
  return data.data;
}

export async function createFixedAsset(payload: FixedAssetCreate): Promise<FixedAsset> {
  const { data } = await apiClient.post<{ success: true; data: FixedAsset; meta?: Meta }>(
    '/fixed-assets',
    payload,
  );
  if (!data.data) throw new Error('固定資産の登録に失敗しました');
  return data.data;
}

export async function disposeFixedAsset(
  id: string,
  payload: { disposal_date: string; disposal_type: 'disposed' | 'sold'; proceeds_amount: number },
): Promise<FixedAsset> {
  const { data } = await apiClient.post<{ success: true; data: FixedAsset; meta?: Meta }>(
    `/fixed-assets/${id}/dispose`,
    payload,
  );
  if (!data.data) throw new Error('除却・売却処理に失敗しました');
  return data.data;
}

export async function runDepreciationBatch(payload: {
  fiscal_period_id: string;
  asset_ids?: string[];
}): Promise<DepreciationRunResult> {
  const { data } = await apiClient.post<{ success: true; data: DepreciationRunResult; meta?: Meta }>(
    '/fixed-assets/depreciation-runs',
    payload,
  );
  if (!data.data) throw new Error('減価償却バッチの実行に失敗しました');
  return data.data;
}
