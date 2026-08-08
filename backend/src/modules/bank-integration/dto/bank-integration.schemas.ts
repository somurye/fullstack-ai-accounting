import { z } from 'zod';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `POST /bank-integration/sync`
 * `start_date`/`end_date`省略時は`BankSyncService`側で「直近30日」を既定値として補完する。
 */
export const bankIntegrationSyncSchema = z
  .object({
    bank_account_id: z.string().uuid('bank_account_idはUUID形式で指定してください'),
    start_date: z.string().regex(DATE_ONLY_RE, 'start_dateはYYYY-MM-DD形式で指定してください').optional(),
    end_date: z.string().regex(DATE_ONLY_RE, 'end_dateはYYYY-MM-DD形式で指定してください').optional(),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
    message: 'end_dateはstart_date以降の日付を指定してください',
    path: ['end_date'],
  });
export type BankIntegrationSyncInput = z.infer<typeof bankIntegrationSyncSchema>;
