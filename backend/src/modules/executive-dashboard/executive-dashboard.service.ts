import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ROLE_PERMISSIONS } from '../../common/guards/permissions.guard';
import { ApprovalRequestsService } from '../approval-requests/approval-requests.service';
import { ContractsService } from '../contracts/contracts.service';
import { PurchaseDashboardService } from '../purchase-dashboard/purchase-dashboard.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SalesDashboardService } from '../sales-dashboard/sales-dashboard.service';
import {
  ExecutiveDashboardSummaryDto,
  ApprovalKpiDto,
  ContractKpiDto,
  PurchaseKpiDto,
  HrKpiDto,
  SalesKpiDto,
} from './executive-dashboard.dto';

@Injectable()
export class ExecutiveDashboardService {
  constructor(
    private readonly approvalRequestsService: ApprovalRequestsService,
    private readonly contractsService: ContractsService,
    private readonly purchaseDashboardService: PurchaseDashboardService,
    private readonly attendanceService: AttendanceService,
    private readonly salesDashboardService: SalesDashboardService,
  ) {}

  /**
   * ユーザーのロール一覧からパーミッション集合を算出する (fail-closed)
   */
  private getEffectivePermissions(roles: string[]): Set<string> {
    const permissions = new Set<string>();
    for (const role of roles) {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      for (const p of perms) {
        permissions.add(p);
      }
    }
    return permissions;
  }

  /**
   * 基本アクセス権限チェック (dashboard.executive_view)
   */
  private assertExecutiveAccess(roles: string[]): void {
    const permissions = this.getEffectivePermissions(roles);
    if (!permissions.has('dashboard.executive_view')) {
      throw AppException.forbidden(
        '横断エグゼクティブダッシュボードを閲覧する権限がありません (要求権限: dashboard.executive_view)',
      );
    }
  }

  /**
   * 横断KPIサマリー取得
   * - 全体認可: dashboard.executive_view
   * - ドメイン別二重認可: 当該ドメインの閲覧権限がない場合は集計を実行せず null を返却 (情報推測防止)
   * - ロジック再利用: 各ドメインの既存Serviceを呼び出すだけの薄い合成レイヤー (SQL直接実行なし)
   */
  async getSummary(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<ExecutiveDashboardSummaryDto> {
    this.assertExecutiveAccess(roles);

    const permissions = this.getEffectivePermissions(roles);
    const availableDomains: string[] = [];

    // ドメイン別権限判定
    const canViewApprovals =
      permissions.has('contract.view') ||
      permissions.has('purchase_request.view') ||
      permissions.has('general_request.view') ||
      roles.includes('owner') ||
      roles.includes('approver') ||
      roles.includes('accounting_manager') ||
      roles.includes('accountant');

    const canViewContracts = permissions.has('contract.view');
    const canViewPurchase = permissions.has('purchase_request.view');
    const canViewHr =
      roles.includes('owner') ||
      roles.includes('payroll_admin');
    const canViewSales =
      permissions.has('deal.view') || permissions.has('quotation.view');

    if (canViewApprovals) availableDomains.push('approvals');
    if (canViewContracts) availableDomains.push('contracts');
    if (canViewPurchase) availableDomains.push('purchase');
    if (canViewHr) availableDomains.push('hr');
    if (canViewSales) availableDomains.push('sales');

    // 各ドメインの既存Serviceを呼び出して結果を合成
    // 閲覧権限のないドメインは呼び出さず null のまま (集計値推測完全防止)
    const [approvals, contracts, purchase, hr, sales] = await Promise.all([
      canViewApprovals
        ? this.approvalRequestsService.getPendingSummary(tenantId, userId)
        : Promise.resolve<ApprovalKpiDto | null>(null),
      canViewContracts
        ? this.contractsService.getExpirySummary(tenantId, userId)
        : Promise.resolve<ContractKpiDto | null>(null),
      canViewPurchase
        ? this.purchaseDashboardService.getExecutivePurchaseKpi(tenantId, userId)
        : Promise.resolve<PurchaseKpiDto | null>(null),
      canViewHr
        ? this.attendanceService.getHrKpiSummary(tenantId, userId)
        : Promise.resolve<HrKpiDto | null>(null),
      canViewSales
        ? this.salesDashboardService.getExecutiveSalesKpi(tenantId, userId, roles)
        : Promise.resolve<SalesKpiDto | null>(null),
    ]);

    return {
      available_domains: availableDomains,
      approvals,
      contracts,
      purchase,
      hr,
      sales,
    };
  }
}
