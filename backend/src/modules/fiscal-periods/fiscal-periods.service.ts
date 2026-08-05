import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface FiscalPeriodDto {
  id: string;
  fiscal_year_id: string;
  period_no: number;
  start_date: string;
  end_date: string;
  status: string;
}

/** `fiscal-years.service.ts` と同じ理由で追加する最小限の読み取り専用一覧取得。 */
@Injectable()
export class FiscalPeriodsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    fiscalYearId?: string,
  ): Promise<FiscalPeriodDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (fiscalYearId) {
        params.push(fiscalYearId);
        conditions.push(`fiscal_year_id = $${params.length}`);
      }
      const result = await client.query<{
        id: string;
        fiscal_year_id: string;
        period_no: number;
        start_date: string;
        end_date: string;
        status: string;
      }>(
        `SELECT id, fiscal_year_id, period_no,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, status
         FROM fiscal_periods WHERE ${conditions.join(' AND ')} ORDER BY start_date ASC`,
        params,
      );
      return result.rows;
    });
  }
}
