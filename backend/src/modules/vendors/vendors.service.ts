import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import type { components } from '../../types/api.generated';
import type { VendorCreateInput } from './dto/vendor.schemas';

export type VendorDto = components['schemas']['Vendor'];

export interface VendorListQuery {
  page: number;
  page_size: number;
  q?: string;
}

interface VendorRow {
  id: string;
  code: string;
  name: string;
  kana_name: string | null;
  invoice_registration_number: string | null;
  bank_account_info: VendorDto['bank_account_info'] | null;
  is_active: boolean;
}

function mapVendorRow(row: VendorRow): VendorDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kana_name: row.kana_name,
    invoice_registration_number: row.invoice_registration_number,
    bank_account_info: row.bank_account_info,
    is_active: row.is_active,
  };
}

const VENDOR_COLUMNS =
  'id, code, name, kana_name, invoice_registration_number, bank_account_info, is_active';

/** 仕入先マスタCRUD(`docs/openapi.yaml` `tags: [Vendors]`)。全銀FB振込先情報を含む */
@Injectable()
export class VendorsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: VendorListQuery,
  ): Promise<{ vendors: VendorDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (query.q) {
        params.push(`%${query.q}%`);
        conditions.push(`(name ILIKE $${params.length} OR kana_name ILIKE $${params.length})`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM vendors WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<VendorRow>(
        `SELECT id, code, name, kana_name, invoice_registration_number, bank_account_info, is_active
         FROM vendors
         WHERE ${whereClause}
         ORDER BY code ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        vendors: result.rows.map(mapVendorRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<VendorDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<VendorRow>(
        `SELECT ${VENDOR_COLUMNS} FROM vendors WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された仕入先が見つかりません');
      }
      return mapVendorRow(row);
    });
  }

  async create(tenantId: string, userId: string | null, dto: VendorCreateInput): Promise<VendorDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<VendorRow>(
        `INSERT INTO vendors (tenant_id, code, name, kana_name, invoice_registration_number, bank_account_info)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${VENDOR_COLUMNS}`,
        [
          tenantId,
          dto.code,
          dto.name,
          dto.kana_name ?? null,
          dto.invoice_registration_number ?? null,
          dto.bank_account_info ? JSON.stringify(dto.bank_account_info) : null,
        ],
      );
      return mapVendorRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: VendorCreateInput,
  ): Promise<VendorDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<VendorRow>(
        `UPDATE vendors
         SET code = $3, name = $4, kana_name = $5, invoice_registration_number = $6,
             bank_account_info = $7, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${VENDOR_COLUMNS}`,
        [
          tenantId,
          id,
          dto.code,
          dto.name,
          dto.kana_name ?? null,
          dto.invoice_registration_number ?? null,
          dto.bank_account_info ? JSON.stringify(dto.bank_account_info) : null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された仕入先が見つかりません');
      }
      return mapVendorRow(row);
    });
  }
}
