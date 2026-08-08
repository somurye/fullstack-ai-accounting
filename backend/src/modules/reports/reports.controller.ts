import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { bsQuerySchema, cashFlowQuerySchema, plQuerySchema, trialBalanceQuerySchema } from './dto/report.schemas';
import { ReportsService } from './reports.service';

/**
 * ReportsController
 * ==================
 * `docs/openapi.yaml` の `tags: [Reports]` に定義されたエンドポイントを実装する。
 * すべて読み取り専用のリアルタイム集計クエリであり、`journal_entries.status = 'posted'`の
 * 確定済み仕訳のみを対象とする。
 *
 * 職務分掌(SoD)RBAC: 財務諸表(試算表/PL/BS/CF)は`ADMIN`/`ACCOUNTANT`のみ閲覧可能
 * (このリポジトリには独立した`/financial-statements`モジュールは存在せず、
 * 財務諸表の実体はこの`ReportsController`であるため、ここへ適用する)。
 */
@Controller('reports')
@UseGuards(TenantAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ACCOUNTANT)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('trial-balance')
  async trialBalance(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(trialBalanceQuerySchema, query);
    const lines = await this.reportsService.trialBalance(tenantId, RequestContext.getUserId(), parsedQuery);
    return successEnvelope(lines);
  }

  @Get('pl')
  async pl(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(plQuerySchema, query);
    const result = await this.reportsService.profitAndLoss(tenantId, RequestContext.getUserId(), parsedQuery);
    return successEnvelope({ period_label: result.periodLabel, lines: result.lines });
  }

  @Get('bs')
  async bs(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(bsQuerySchema, query);
    const result = await this.reportsService.balanceSheet(tenantId, RequestContext.getUserId(), parsedQuery);
    return successEnvelope({ period_label: result.periodLabel, lines: result.lines });
  }

  @Get('cash-flow')
  async cashFlow(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(cashFlowQuerySchema, query);
    const result = await this.reportsService.cashFlow(tenantId, RequestContext.getUserId(), parsedQuery);
    return successEnvelope({
      period_label: result.periodLabel,
      beginning_cash_balance: result.beginningCashBalance,
      operating_activities: result.operatingActivities,
      operating_activities_total: result.operatingActivitiesTotal,
      investing_activities: result.investingActivities,
      investing_activities_total: result.investingActivitiesTotal,
      financing_activities: result.financingActivities,
      financing_activities_total: result.financingActivitiesTotal,
      net_change_in_cash: result.netChangeInCash,
      ending_cash_balance: result.endingCashBalance,
    });
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
