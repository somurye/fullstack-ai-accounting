import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedRequest } from './tenant-auth.guard';

/**
 * ロールに割り当てられたパーミッションマッピング。
 * sql/008b_legal_roles_setup.sql の role_permissions テーブル定義に完全準拠。
 */
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: [
    'contract.create',
    'contract.view',
    'contract.edit',
    'contract.approve',
    'contract.terminate',
    'notification.batch_execute',
    'general_request.create',
    'general_request.view',
    'general_request.edit',
    'general_request.approve',
    'purchase_request.create',
    'purchase_request.view',
    'purchase_request.edit',
    'purchase_request.approve',
    'purchase_request.terminate',
    'purchase_request.receive',
    'purchase_request.link_bill',
    'supplier.create',
    'supplier.view',
    'supplier.edit',
    'quotation.create',
    'quotation.view',
    'quotation.edit',
    'quotation.send',
    'quotation.convert',
    'deal.create',
    'deal.view',
    'deal.edit',
    'deal.close',
    'contract_renewal_link.create',
    'contract_renewal_link.view',
    'dashboard.view',
    'dashboard.executive_view',
    'recommendation.view',
    'recommendation.act',
    // 人事労務・給与系パーミッション (Phase 2: 021, 024, 027, 029)
    'attendance.create',
    'attendance.edit',
    'attendance.view',
    'employee.create',
    'employee.edit',
    'employee.view',
    'payroll.create',
    'payroll.view',
    'payroll.approve',
    'payslip.create',
    'payslip.view',
    'rate_master.create',
    'rate_master.edit',
    'rate_master.view',
    'year_end_adjustment.create',
    'year_end_adjustment.view',
    'year_end_adjustment.approve',
  ],
  legal_admin: [
    'contract.create',
    'contract.view',
    'contract.edit',
    'contract.approve',
    'contract.terminate',
    'general_request.create',
    'general_request.view',
    'general_request.edit',
    'general_request.approve',
    'purchase_request.view',
    'purchase_request.approve',
    'supplier.view',
    'quotation.view',
    'deal.view',
    'contract_renewal_link.create',
    'contract_renewal_link.view',
    'dashboard.view',
    'dashboard.executive_view',
    'recommendation.view',
    'recommendation.act',
  ],
  legal_viewer: [
    'contract.view',
    'general_request.view',
    'purchase_request.view',
    'supplier.view',
    'quotation.view',
    'deal.view',
    'contract_renewal_link.view',
    'dashboard.view',
    'recommendation.view',
  ],
  approver: [
    'contract.view',
    'contract.approve',
    'general_request.view',
    'general_request.approve',
    'purchase_request.view',
    'purchase_request.approve',
    'purchase_request.receive',
    'supplier.view',
    'quotation.view',
    'deal.view',
    'contract_renewal_link.view',
    'dashboard.view',
    'dashboard.executive_view',
    'recommendation.view',
    'recommendation.act',
    // 人事労務・給与系パーミッション (Phase 2)
    'attendance.view',
    'employee.view',
    'payroll.view',
    'payroll.approve',
    'rate_master.view',
  ],
  accounting_manager: [
    'contract.view',
    'general_request.view',
    'purchase_request.view',
    'purchase_request.receive',
    'purchase_request.link_bill',
    'supplier.create',
    'supplier.view',
    'supplier.edit',
    'quotation.create',
    'quotation.view',
    'quotation.edit',
    'quotation.send',
    'quotation.convert',
    'deal.create',
    'deal.view',
    'deal.edit',
    'deal.close',
    'contract_renewal_link.create',
    'contract_renewal_link.view',
    'dashboard.view',
    'dashboard.executive_view',
    'recommendation.view',
    'recommendation.act',
    // 人事労務・給与系パーミッション (Phase 2)
    'attendance.view',
    'employee.view',
    'payroll.create',
    'payroll.view',
    'payroll.approve',
    'payslip.view',
    'rate_master.view',
    'year_end_adjustment.view',
    'year_end_adjustment.approve',
  ],
  accountant: [
    'contract.view',
    'general_request.view',
    'purchase_request.view',
    'purchase_request.receive',
    'purchase_request.link_bill',
    'supplier.create',
    'supplier.view',
    'supplier.edit',
    'quotation.view',
    'quotation.convert',
    'deal.view',
    'contract_renewal_link.view',
    'dashboard.view',
    'dashboard.executive_view',
    'recommendation.view',
    'recommendation.act',
  ],
  bookkeeper: [
    'quotation.view',
    'deal.view',
    'contract_renewal_link.view',
    'dashboard.view',
  ],
  employee: [
    'general_request.create',
    'general_request.view',
    'general_request.edit',
    'purchase_request.create',
    'purchase_request.view',
    'purchase_request.edit',
    'purchase_request.receive',
    'supplier.view',
    'quotation.create',
    'quotation.view',
    'quotation.edit',
    'quotation.send',
    'deal.create',
    'deal.view',
    'deal.edit',
    'deal.close',
    'contract_renewal_link.create',
    'contract_renewal_link.view',
    'dashboard.view',
    'recommendation.view',
    'recommendation.act',
    // 人事労務・給与系パーミッション (Phase 2)
    'attendance.create',
    'attendance.edit',
    'attendance.view',
    'employee.view',
    'payslip.view',
    'year_end_adjustment.view',
  ],
  payroll_admin: [
    'dashboard.executive_view',
    'recommendation.view',
    'recommendation.act',
    // 人事労務・給与系パーミッション (Phase 2: 021, 024, 027, 029)
    'attendance.create',
    'attendance.edit',
    'attendance.view',
    'employee.create',
    'employee.edit',
    'employee.view',
    'payroll.create',
    'payroll.view',
    'payroll.approve',
    'payslip.create',
    'payslip.view',
    'rate_master.create',
    'rate_master.edit',
    'rate_master.view',
    'year_end_adjustment.create',
    'year_end_adjustment.view',
    'year_end_adjustment.approve',
  ],
  viewer_external: [],
};

/**
 * PermissionsGuard
 * ================
 * 細粒度パーミッション (RBAC) の認可ガード (DEBT-005)。
 *
 * `@RequirePermissions(...)` で宣言された要求パーミッションと、
 * `TenantAuthGuard` 検証済みの JWT クレーム `roles` を突き合わせ、
 * ユーザーが要求パーミッションを満たしていない場合は 403 (Forbidden) を返す。
 *
 * - 多層防御の原則:
 *   既存の `TenantAuthGuard` (テナント分離) および DB 側 RLS / トリガーを
 *   一切弱めず、API 層での早期拒否レイヤーとして機能する。
 * - 複数パーミッション指定時は OR 条件 (いずれか1つを満たせば許可)。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRoles = req.user?.roles ?? [];

    // ユーザーの保有ロールからパーミッション集合を算出 (fail-closed)
    const userPermissions = new Set<string>();
    for (const role of userRoles) {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      for (const p of perms) {
        userPermissions.add(p);
      }
    }

    // いずれかの要求パーミッションを満たしているか判定
    const hasPermission = requiredPermissions.some((p) => userPermissions.has(p));

    if (!hasPermission) {
      throw AppException.forbidden('この操作を行う権限がありません(パーミッション不足)');
    }

    return true;
  }
}
