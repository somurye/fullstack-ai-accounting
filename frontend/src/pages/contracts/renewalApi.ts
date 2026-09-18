import { apiClient } from '../../lib/apiClient';

export interface CreateRenewalDealParams {
  contract_id: string;
  customer_id?: string;
  title?: string;
  expected_amount?: number;
  expected_close_date?: string | null;
  owner_user_id?: string | null;
}

export interface ContractRenewalLinkInfo {
  id: string;
  tenant_id: string;
  contract_id: string;
  deal_id: string | null;
  quotation_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  contract?: {
    id: string;
    contract_no: string;
    title: string;
    counterparty_name: string;
    contract_type: string;
    contract_amount?: number | null;
    start_date: string;
    end_date: string | null;
    auto_renewal?: boolean;
    status: string;
  };
  deal?: {
    id: string;
    title: string;
    stage: string;
    expected_amount: number;
    expected_close_date: string | null;
  };
}

export async function createRenewalDeal(params: CreateRenewalDealParams) {
  const res = await apiClient.post<{
    data: {
      link: ContractRenewalLinkInfo;
      deal: { id: string; title: string };
    };
  }>('/contract-renewal-links/create-deal', params);
  return res.data.data;
}

export async function fetchRenewalLinkByDeal(dealId: string): Promise<ContractRenewalLinkInfo | null> {
  const res = await apiClient.get<{ data: ContractRenewalLinkInfo | null }>(
    `/contract-renewal-links/by-deal/${dealId}`,
  );
  return res.data.data;
}

export async function fetchRenewalLinksByContract(contractId: string): Promise<ContractRenewalLinkInfo[]> {
  const res = await apiClient.get<{ data: ContractRenewalLinkInfo[] }>(
    `/contract-renewal-links/by-contract/${contractId}`,
  );
  return res.data.data;
}
