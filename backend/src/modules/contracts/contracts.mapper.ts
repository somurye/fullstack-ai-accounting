import type { components } from '../../types/api.generated';
import type { ContractStatus, ContractType } from './dto/contract.schemas';

export type ContractDto = components['schemas']['Contract'];
export type ContractDetailDto = components['schemas']['ContractDetail'];
export type ContractAttachmentDto = NonNullable<ContractDetailDto['attachment']>;
export type ContractApprovalHistoryEntryDto = components['schemas']['ApprovalHistoryEntry'];

export interface ContractRow {
  id: string;
  contract_no: string;
  title: string;
  counterparty_name: string;
  contract_type: string;
  contract_amount: string | null;
  currency: string;
  start_date: string;
  end_date: string | null;
  auto_renewal: boolean;
  renewal_notice_days: number;
  status: string;
  attachment_id: string | null;
  source_suggestion_id: string | null;
  description: string | null;
  approved_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export const SQL_CONTRACT_COLUMNS = `
  c.id,
  c.contract_no,
  c.title,
  c.counterparty_name,
  c.contract_type,
  c.contract_amount,
  c.currency,
  c.start_date::text,
  c.end_date::text,
  c.auto_renewal,
  c.renewal_notice_days,
  c.status,
  c.attachment_id,
  c.source_suggestion_id,
  c.description,
  c.approved_at,
  c.created_by,
  c.created_at,
  c.updated_at
`;

export function mapContractRow(row: ContractRow): ContractDto {
  return {
    id: row.id,
    contract_no: row.contract_no,
    title: row.title,
    counterparty_name: row.counterparty_name,
    contract_type: row.contract_type as ContractType,
    contract_amount: row.contract_amount !== null ? Number(row.contract_amount) : null,
    currency: row.currency,
    start_date: row.start_date,
    end_date: row.end_date,
    auto_renewal: Boolean(row.auto_renewal),
    renewal_notice_days: Number(row.renewal_notice_days),
    status: row.status as ContractStatus,
    attachment_id: row.attachment_id,
    source_suggestion_id: row.source_suggestion_id,
    description: row.description,
    approved_at: row.approved_at ? row.approved_at.toISOString() : null,
    created_by: row.created_by,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
