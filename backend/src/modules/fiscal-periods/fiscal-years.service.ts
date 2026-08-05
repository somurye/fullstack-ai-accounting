import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface FiscalYearDto {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
}

/**
 * `docs/openapi.yaml` に `/fiscal-years` の定義は無いが、固定資産の減価償却バッチ
 * (`fiscal_period_id`)・消費税申告(`fiscal_year_id`)のフロントエンド選択UIに必須のため、
 * 最小限の読み取り専用一覧取得として追加する(`invoices`タスクでの`GET /customers`拡張等と
 * 同じ考え方: ドキュメント化されたレスポンス/画面要件を満たすために必要な実体として追加)。
 */
@Injectable()
export class FiscalYearsService {
  constructor(private readonly db: DatabaseService) {}

  async list(tenantId: string, userId: string | null): Promise<FiscalYearDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<{
        id: string;
        start_date: string;
        end_date: string;
        status: string;
      }>(
        `SELECT id, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, status
         FROM fiscal_years WHERE tenant_id = $1 ORDER BY start_date DESC`,
        [tenantId],
      );
      return result.rows;
    });
  }
}
