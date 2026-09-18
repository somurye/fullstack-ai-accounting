import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DealsService } from '../deals/deals.service';
import { AppException } from '../../common/exceptions/app.exception';
import {
  CreateRenewalDealInput,
  ContractRenewalLinkDto,
} from './dto/contract-renewal-link.schemas';

interface ContractRow {
  id: string;
  tenant_id: string;
  contract_no: string;
  title: string;
  counterparty_name: string;
  contract_type: string;
  contract_amount: string | null;
  currency: string;
  start_date: string;
  end_date: string | null;
  auto_renewal: boolean;
  status: string;
}

@Injectable()
export class ContractRenewalLinksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
    private readonly dealsService: DealsService,
  ) {}

  /**
   * RBAC権限チェックヘルパー
   */
  private assertPermission(roles: string[], permission: string): void {
    const rolePermissionsMap: Record<string, string[]> = {
      owner: ['contract_renewal_link.create', 'contract_renewal_link.view'],
      legal_admin: ['contract_renewal_link.create', 'contract_renewal_link.view'],
      accounting_manager: ['contract_renewal_link.create', 'contract_renewal_link.view'],
      employee: ['contract_renewal_link.create', 'contract_renewal_link.view'],
      accountant: ['contract_renewal_link.view'],
      legal_viewer: ['contract_renewal_link.view'],
      approver: ['contract_renewal_link.view'],
      bookkeeper: ['contract_renewal_link.view'],
    };

    const hasPermission = roles.some((role) =>
      rolePermissionsMap[role]?.includes(permission),
    );

    if (!hasPermission) {
      throw AppException.forbidden(
        `この操作を実行する権限がありません (要求権限: ${permission})`,
      );
    }
  }

  /**
   * 契約更新提案の商談（案件）を人間の明示的操作によって起票し、リンクを記録する。
   *
   * 【原則】
   * アラートから自動生成・自動確定されることはなく、必ず人間の明示的操作
   * (ボタン押下/APIリクエスト) を経て lead ステージの案件が起票される。
   */
  async createRenewalDeal(
    tenantId: string,
    userId: string,
    roles: string[],
    input: CreateRenewalDealInput,
  ): Promise<{ link: ContractRenewalLinkDto; deal: any }> {
    this.assertPermission(roles, 'contract_renewal_link.create');

    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 対象契約の存在・テナント所属確認 (RLS + 明示テナント条件)
      const contractRes = await client.query<ContractRow>(
        `SELECT
           id, tenant_id, contract_no, title, counterparty_name, contract_type,
           contract_amount, currency, start_date::text, end_date::text,
           auto_renewal, status
         FROM contracts
         WHERE id = $1 AND tenant_id = $2`,
        [input.contract_id, tenantId],
      );

      if (contractRes.rows.length === 0) {
        throw AppException.notFound(`契約が見つかりません (ID: ${input.contract_id})`);
      }
      const contract = contractRes.rows[0];

      // 2. 顧客 (customer_id) の解決
      let customerId = input.customer_id;
      if (!customerId) {
        // counterparty_name から同名の既存顧客を自テナント内で検索 (完全一致のみ)
        const custRes = await client.query<{ id: string }>(
          `SELECT id FROM customers
           WHERE tenant_id = $1 AND name = $2 AND is_active = TRUE
           LIMIT 2`,
          [tenantId, contract.counterparty_name],
        );

        if (custRes.rows.length === 1) {
          customerId = custRes.rows[0].id;
        } else if (custRes.rows.length > 1) {
          throw AppException.badRequest(
            `契約の相手先「${contract.counterparty_name}」に一致する顧客が複数存在します。顧客ID (customer_id) を明示指定してください。`,
          );
        } else {
          throw AppException.badRequest(
            `契約の相手先「${contract.counterparty_name}」に一致する顧客マスタが見つかりません。顧客ID (customer_id) を指定してください。`,
          );
        }
      } else {
        // 指定された顧客の存在・テナント所属検証
        const checkCust = await client.query(
          `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2`,
          [customerId, tenantId],
        );
        if (checkCust.rows.length === 0) {
          throw AppException.notFound(`指定された顧客が見つかりません (ID: ${customerId})`);
        }
      }

      // 3. 案件 (deals) の作成 (P4-T2 の DealsService を再利用)
      const dealTitle = (input.title || `契約更新: ${contract.title}`).trim().slice(0, 200);
      const expectedAmount =
        input.expected_amount !== undefined
          ? input.expected_amount
          : contract.contract_amount != null
            ? Number(contract.contract_amount)
            : 0;
      const expectedCloseDate = input.expected_close_date || contract.end_date || null;

      // DealsService.create は内部で db.transaction を呼ぶが、既にトランザクション内でも安全に実行される
      // 設計確定-03: contract_renewal_link.create 権限を持つユーザーは deal.create を別途持たなくても起票可能
      const createdDeal = await this.dealsService.create(
        tenantId,
        userId,
        roles,
        {
          customer_id: customerId,
          title: dealTitle,
          stage: 'lead',
          expected_amount: expectedAmount,
          currency_code: contract.currency || 'JPY',
          expected_close_date: expectedCloseDate,
          owner_user_id: input.owner_user_id || null,
        },
        { skipPermissionCheck: true },
      );

      // 4. contract_renewal_links へのリンク記録
      const linkInsertSql = `
        INSERT INTO contract_renewal_links (
          tenant_id, contract_id, deal_id, created_by
        ) VALUES (
          $1, $2, $3, $4
        )
        RETURNING id, tenant_id, contract_id, deal_id, quotation_id, created_by,
                  created_at::text, updated_at::text
      `;
      const linkRes = await client.query(linkInsertSql, [
        tenantId,
        contract.id,
        createdDeal.id,
        userId,
      ]);
      const linkRow = linkRes.rows[0];

      // 5. 監査ログ記録
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract_renewal_link.create',
        targetType: 'contract_renewal_link',
        targetId: linkRow.id,
        afterData: {
          contract_id: contract.id,
          deal_id: createdDeal.id,
          deal_title: dealTitle,
        },
      });

      const linkDto: ContractRenewalLinkDto = {
        id: linkRow.id,
        tenant_id: linkRow.tenant_id,
        contract_id: linkRow.contract_id,
        deal_id: linkRow.deal_id,
        quotation_id: linkRow.quotation_id,
        created_by: linkRow.created_by,
        created_at: linkRow.created_at,
        updated_at: linkRow.updated_at,
        contract: {
          id: contract.id,
          contract_no: contract.contract_no,
          title: contract.title,
          counterparty_name: contract.counterparty_name,
          contract_type: contract.contract_type,
          contract_amount: contract.contract_amount ? Number(contract.contract_amount) : null,
          start_date: contract.start_date,
          end_date: contract.end_date,
          auto_renewal: contract.auto_renewal,
          status: contract.status,
        },
        deal: {
          id: createdDeal.id,
          title: createdDeal.title,
          stage: createdDeal.stage,
          expected_amount: createdDeal.expected_amount,
          expected_close_date: createdDeal.expected_close_date,
        },
      };

      return {
        link: linkDto,
        deal: createdDeal,
      };
    });
  }

  /**
   * 案件IDから紐づく契約連携情報を取得する (案件詳細画面からの逆引き表示)
   */
  async findByDealId(
    tenantId: string,
    userId: string,
    roles: string[],
    dealId: string,
  ): Promise<ContractRenewalLinkDto | null> {
    this.assertPermission(roles, 'contract_renewal_link.view');

    const sql = `
      SELECT
        crl.id, crl.tenant_id, crl.contract_id, crl.deal_id, crl.quotation_id,
        crl.created_by, crl.created_at::text, crl.updated_at::text,
        c.contract_no, c.title AS contract_title, c.counterparty_name,
        c.contract_type, c.contract_amount, c.start_date::text, c.end_date::text,
        c.auto_renewal, c.status AS contract_status
      FROM contract_renewal_links crl
      JOIN contracts c ON c.id = crl.contract_id AND c.tenant_id = crl.tenant_id
      WHERE crl.deal_id = $1 AND crl.tenant_id = $2
      ORDER BY crl.created_at DESC
      LIMIT 1
    `;

    const res = await this.db.query(sql, [dealId, tenantId]);
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];

    return {
      id: row.id,
      tenant_id: row.tenant_id,
      contract_id: row.contract_id,
      deal_id: row.deal_id,
      quotation_id: row.quotation_id,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      contract: {
        id: row.contract_id,
        contract_no: row.contract_no,
        title: row.contract_title,
        counterparty_name: row.counterparty_name,
        contract_type: row.contract_type,
        contract_amount: row.contract_amount ? Number(row.contract_amount) : null,
        start_date: row.start_date,
        end_date: row.end_date,
        auto_renewal: row.auto_renewal,
        status: row.contract_status,
      },
    };
  }

  /**
   * 契約IDから紐づく更新連携一覧を取得する (契約詳細画面からの参照表示)
   */
  async findByContractId(
    tenantId: string,
    userId: string,
    roles: string[],
    contractId: string,
  ): Promise<ContractRenewalLinkDto[]> {
    this.assertPermission(roles, 'contract_renewal_link.view');

    const sql = `
      SELECT
        crl.id, crl.tenant_id, crl.contract_id, crl.deal_id, crl.quotation_id,
        crl.created_by, crl.created_at::text, crl.updated_at::text,
        d.title AS deal_title, d.stage AS deal_stage, d.expected_amount AS deal_expected_amount,
        d.expected_close_date::text AS deal_expected_close_date
      FROM contract_renewal_links crl
      LEFT JOIN deals d ON d.id = crl.deal_id AND d.tenant_id = crl.tenant_id
      WHERE crl.contract_id = $1 AND crl.tenant_id = $2
      ORDER BY crl.created_at DESC
    `;

    const res = await this.db.query(sql, [contractId, tenantId]);

    return res.rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      contract_id: row.contract_id,
      deal_id: row.deal_id,
      quotation_id: row.quotation_id,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deal: row.deal_id
        ? {
            id: row.deal_id,
            title: row.deal_title,
            stage: row.deal_stage,
            expected_amount: Number(row.deal_expected_amount || 0),
            expected_close_date: row.deal_expected_close_date,
          }
        : undefined,
    }));
  }

  /**
   * 契約更新案件に見積書を紐付ける (NULLから一度限りの設定、P4-T1 WORM準拠、設計確定-01, 02)
   */
  async attachQuotation(
    tenantId: string,
    userId: string,
    roles: string[],
    dealId: string,
    quotationId: string,
  ): Promise<ContractRenewalLinkDto> {
    this.assertPermission(roles, 'contract_renewal_link.create');

    return this.db.transaction(tenantId, userId, async (client) => {
      // リンクレコードの存在確認
      const linkRes = await client.query<{ id: string; quotation_id: string | null }>(
        `SELECT id, quotation_id FROM contract_renewal_links
         WHERE deal_id = $1 AND tenant_id = $2`,
        [dealId, tenantId],
      );

      if (linkRes.rows.length === 0) {
        throw AppException.notFound(`対象案件 (deal_id: ${dealId}) に紐づく契約更新リンクが見つかりません`);
      }

      if (linkRes.rows[0].quotation_id != null) {
        throw AppException.badRequest(`この契約更新リンクには既に見積書が紐付けられています (再設定不可)`);
      }

      // UPDATE (DB側トリガー fn_validate_contract_renewal_link_quotation_deal により deal_id 不一致は 23503 で弾かれる)
      await client.query(
        `UPDATE contract_renewal_links
         SET quotation_id = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [quotationId, linkRes.rows[0].id, tenantId],
      );

      // トランザクション内クライアントで最新状態を取得 (未コミット読み取り不整合を防止)
      const fetchSql = `
        SELECT
          crl.id, crl.tenant_id, crl.contract_id, crl.deal_id, crl.quotation_id,
          crl.created_by, crl.created_at::text, crl.updated_at::text,
          c.contract_no, c.title AS contract_title, c.counterparty_name,
          c.contract_type, c.contract_amount, c.start_date::text, c.end_date::text,
          c.auto_renewal, c.status AS contract_status
        FROM contract_renewal_links crl
        JOIN contracts c ON c.id = crl.contract_id AND c.tenant_id = crl.tenant_id
        WHERE crl.id = $1 AND crl.tenant_id = $2
      `;
      const fetchRes = await client.query(fetchSql, [linkRes.rows[0].id, tenantId]);
      if (fetchRes.rows.length === 0) {
        throw AppException.notFound(`更新後の連携情報が見つかりません`);
      }
      const row = fetchRes.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract_renewal_link.attach_quotation',
        targetType: 'contract_renewal_link',
        targetId: linkRes.rows[0].id,
        beforeData: { quotation_id: null },
        afterData: { quotation_id: quotationId, deal_id: dealId },
      });

      return {
        id: row.id,
        tenant_id: row.tenant_id,
        contract_id: row.contract_id,
        deal_id: row.deal_id,
        quotation_id: row.quotation_id,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        contract: {
          id: row.contract_id,
          contract_no: row.contract_no,
          title: row.contract_title,
          counterparty_name: row.counterparty_name,
          contract_type: row.contract_type,
          contract_amount: row.contract_amount ? Number(row.contract_amount) : null,
          start_date: row.start_date,
          end_date: row.end_date,
          auto_renewal: row.auto_renewal,
          status: row.contract_status,
        },
      };
    });
  }
}
