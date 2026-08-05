import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { ConsumptionTaxReturn, ConsumptionTaxReturnListParams, TaxFilingMethod } from './types';

type Meta = components['schemas']['Meta'];

export interface ConsumptionTaxReturnListResult {
  returns: ConsumptionTaxReturn[];
  meta: Meta | undefined;
}

export async function fetchConsumptionTaxReturns(
  params: ConsumptionTaxReturnListParams,
): Promise<ConsumptionTaxReturnListResult> {
  const { data } = await apiClient.get<{ success: true; data: ConsumptionTaxReturn[]; meta?: Meta }>(
    '/consumption-tax-returns',
    { params },
  );
  return { returns: data.data ?? [], meta: data.meta };
}

export async function fetchConsumptionTaxReturn(id: string): Promise<ConsumptionTaxReturn> {
  const { data } = await apiClient.get<{ success: true; data: ConsumptionTaxReturn; meta?: Meta }>(
    `/consumption-tax-returns/${id}`,
  );
  if (!data.data) throw new Error('消費税申告データを取得できませんでした');
  return data.data;
}

export async function createConsumptionTaxReturn(payload: {
  fiscal_year_id: string;
  filing_method: TaxFilingMethod;
}): Promise<ConsumptionTaxReturn> {
  const { data } = await apiClient.post<{ success: true; data: ConsumptionTaxReturn; meta?: Meta }>(
    '/consumption-tax-returns',
    payload,
  );
  if (!data.data) throw new Error('消費税申告データの作成に失敗しました');
  return data.data;
}

export async function recalculateConsumptionTaxReturn(id: string): Promise<ConsumptionTaxReturn> {
  const { data } = await apiClient.post<{ success: true; data: ConsumptionTaxReturn; meta?: Meta }>(
    `/consumption-tax-returns/${id}/calculate`,
  );
  if (!data.data) throw new Error('再計算に失敗しました');
  return data.data;
}

export async function finalizeConsumptionTaxReturn(id: string): Promise<ConsumptionTaxReturn> {
  const { data } = await apiClient.post<{ success: true; data: ConsumptionTaxReturn; meta?: Meta }>(
    `/consumption-tax-returns/${id}/finalize`,
  );
  if (!data.data) throw new Error('確定処理に失敗しました');
  return data.data;
}
