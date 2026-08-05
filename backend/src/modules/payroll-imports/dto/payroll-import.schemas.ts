import { z } from 'zod';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const payrollImportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type PayrollImportListQuery = z.infer<typeof payrollImportListQuerySchema>;

/** `POST /payroll-imports/csv` はmultipart/form-dataのため、file以外は文字列で届く。 */
export const payrollImportCsvFieldsSchema = z.object({
  import_mapping_id: z.string().uuid('import_mapping_idはUUID形式で指定してください'),
  pay_period_start: z.string().regex(DATE_ONLY_RE, 'pay_period_startはYYYY-MM-DD形式で指定してください'),
  pay_period_end: z.string().regex(DATE_ONLY_RE, 'pay_period_endはYYYY-MM-DD形式で指定してください'),
  payment_date: z.string().regex(DATE_ONLY_RE, 'payment_dateはYYYY-MM-DD形式で指定してください'),
});
export type PayrollImportCsvFields = z.infer<typeof payrollImportCsvFieldsSchema>;
