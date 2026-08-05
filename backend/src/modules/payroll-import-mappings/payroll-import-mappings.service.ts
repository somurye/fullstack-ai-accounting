import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { DatabaseService } from '../../database/database.service';
import type { components } from '../../types/api.generated';
import type {
  PayrollImportAccountMapping,
  PayrollImportColumnMapping,
  PayrollImportMappingCreateInput,
  PayrollImportMappingListQuery,
} from './dto/payroll-import-mapping.schemas';

export type PayrollImportMappingDto = components['schemas']['PayrollImportMapping'];

export interface PayrollImportMappingRow {
  id: string;
  name: string;
  column_mapping: PayrollImportColumnMapping;
  account_mapping: PayrollImportAccountMapping;
  is_active: boolean;
}

export const PAYROLL_IMPORT_MAPPING_COLUMNS = 'id, name, column_mapping, account_mapping, is_active';

export function mapPayrollImportMappingRow(row: PayrollImportMappingRow): PayrollImportMappingDto {
  return {
    id: row.id,
    name: row.name,
    column_mapping: row.column_mapping,
    account_mapping: row.account_mapping,
    is_active: row.is_active,
  };
}

/**
 * PayrollImportMappingsService
 * ============================
 * 給与CSV取込マッピング設定(`payroll_import_mappings`)のCRUD。
 * `docs/openapi.yaml` にはもともとCRUDエンドポイントが定義されていなかったが
 * (`bank_import_profiles` と同様、IDでの参照のみを前提とした設計)、
 * `POST /payroll-imports/csv` が `import_mapping_id` を必須とするため、
 * マッピングを作成・編集する手段がなければ本機能自体が利用不能になる。
 * そのため本タスクでは `docs/openapi.yaml` 側にCRUDエンドポイントを追加した上で実装する。
 */
@Injectable()
export class PayrollImportMappingsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: PayrollImportMappingListQuery,
  ): Promise<{ mappings: PayrollImportMappingDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.is_active !== undefined) {
        params.push(query.is_active);
        conditions.push(`is_active = $${params.length}`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM payroll_import_mappings WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<PayrollImportMappingRow>(
        `SELECT ${PAYROLL_IMPORT_MAPPING_COLUMNS} FROM payroll_import_mappings
         WHERE ${whereClause}
         ORDER BY name ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        mappings: result.rows.map(mapPayrollImportMappingRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: PayrollImportMappingCreateInput,
  ): Promise<PayrollImportMappingDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<PayrollImportMappingRow>(
        `INSERT INTO payroll_import_mappings (tenant_id, name, column_mapping, account_mapping, is_active)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
         RETURNING ${PAYROLL_IMPORT_MAPPING_COLUMNS}`,
        [
          tenantId,
          dto.name,
          JSON.stringify(dto.column_mapping),
          JSON.stringify(dto.account_mapping),
          dto.is_active,
        ],
      );
      return mapPayrollImportMappingRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: PayrollImportMappingCreateInput,
  ): Promise<PayrollImportMappingDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<PayrollImportMappingRow>(
        `UPDATE payroll_import_mappings
         SET name = $3, column_mapping = $4::jsonb, account_mapping = $5::jsonb, is_active = $6
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${PAYROLL_IMPORT_MAPPING_COLUMNS}`,
        [
          tenantId,
          id,
          dto.name,
          JSON.stringify(dto.column_mapping),
          JSON.stringify(dto.account_mapping),
          dto.is_active,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された給与CSV取込マッピング設定が見つかりません');
      }
      return mapPayrollImportMappingRow(row);
    });
  }
}
