import type { components } from '../../../types/api.generated';

export type AutoJournalRule = components['schemas']['AutoJournalRule'];

export interface AutoJournalRuleListParams {
  page?: number;
  page_size?: number;
  source?: 'bank' | 'card';
  is_active?: boolean;
}

export interface AutoJournalRuleFormInput {
  rule_name: string;
  priority: number;
  source: 'bank' | 'card';
  match_pattern: string;
  min_amount?: number;
  max_amount?: number;
  debit_account_id?: string;
  credit_account_id?: string;
}
