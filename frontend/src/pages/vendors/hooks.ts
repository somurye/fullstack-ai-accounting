import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { createVendor, fetchVendors, updateVendor } from './api';
import type { VendorFormInput, VendorListParams } from './types';

const VENDORS_KEY = 'vendors';

export function useVendors(params: VendorListParams) {
  return useQuery({
    queryKey: [VENDORS_KEY, 'list', params],
    queryFn: () => fetchVendors(params),
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: VendorFormInput) => createVendor(dto),
    onSuccess: (vendor) => {
      queryClient.invalidateQueries({ queryKey: [VENDORS_KEY] });
      toast.success(`仕入先「${vendor.name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: VendorFormInput }) => updateVendor(id, dto),
    onSuccess: (vendor) => {
      queryClient.invalidateQueries({ queryKey: [VENDORS_KEY] });
      toast.success(`仕入先「${vendor.name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
