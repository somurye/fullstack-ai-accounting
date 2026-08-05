import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import type { components } from '../../types/api.generated';

export type TenantDto = components['schemas']['Tenant'];

interface TenantRow {
  id: string;
  name: string;
  legal_name: string | null;
  fiscal_year_start_month: number;
  invoice_registration_number: string | null;
  consumption_tax_filing_method: string;
  base_currency_code: string;
  is_active: boolean;
}

function mapTenantRow(row: TenantRow): TenantDto {
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legal_name ?? undefined,
    fiscal_year_start_month: row.fiscal_year_start_month,
    invoice_registration_number: row.invoice_registration_number ?? undefined,
    consumption_tax_filing_method:
      row.consumption_tax_filing_method as TenantDto['consumption_tax_filing_method'],
    base_currency_code: row.base_currency_code,
    is_active: row.is_active,
  };
}

/** `docs/openapi.yaml` `tags: [Tenants]` の `GET /tenants/me` を実装する */
@Injectable()
export class TenantsService {
  constructor(private readonly db: DatabaseService) {}

  async getCurrent(tenantId: string, userId: string | null): Promise<TenantDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT id, name, legal_name, fiscal_year_start_month, invoice_registration_number,
                consumption_tax_filing_method, base_currency_code, is_active
         FROM tenants
         WHERE id = $1`,
        [tenantId],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('テナントが見つかりません');
      }
      return mapTenantRow(row);
    });
  }
}
