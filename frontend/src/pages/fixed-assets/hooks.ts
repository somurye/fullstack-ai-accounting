import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { useAccounts, useDepartments } from '../journal-entries/hooks';
import {
  createFixedAsset,
  disposeFixedAsset,
  fetchFixedAsset,
  fetchFixedAssets,
  runDepreciationBatch,
} from './api';
import type { FixedAssetCreate, FixedAssetListParams } from './types';

const FIXED_ASSETS_KEY = 'fixed-assets';

export { useAccounts, useDepartments };

export function useFixedAssets(params: FixedAssetListParams) {
  return useQuery({
    queryKey: [FIXED_ASSETS_KEY, 'list', params],
    queryFn: () => fetchFixedAssets(params),
  });
}

export function useFixedAsset(id: string | undefined) {
  return useQuery({
    queryKey: [FIXED_ASSETS_KEY, 'detail', id],
    queryFn: () => fetchFixedAsset(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateFixedAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FixedAssetCreate) => createFixedAsset(payload),
    onSuccess: (asset) => {
      queryClient.invalidateQueries({ queryKey: [FIXED_ASSETS_KEY, 'list'] });
      toast.success(`固定資産 ${asset.asset_no} を登録しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useDisposeFixedAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      disposal_date,
      disposal_type,
      proceeds_amount,
    }: {
      id: string;
      disposal_date: string;
      disposal_type: 'disposed' | 'sold';
      proceeds_amount: number;
    }) => disposeFixedAsset(id, { disposal_date, disposal_type, proceeds_amount }),
    onSuccess: (asset) => {
      queryClient.invalidateQueries({ queryKey: [FIXED_ASSETS_KEY] });
      toast.success(`固定資産 ${asset.asset_no} を${asset.status === 'sold' ? '売却' : '除却'}しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRunDepreciationBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { fiscal_period_id: string; asset_ids?: string[] }) =>
      runDepreciationBatch(payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [FIXED_ASSETS_KEY] });
      toast.success(`${result.processed_count}件の資産の減価償却仕訳(draft)を起票しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
