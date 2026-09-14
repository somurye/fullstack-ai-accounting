import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  calculatePayrollSchema,
  closePayrollProfileSchema,
  createPayrollPeriodSchema,
  createPayrollProfileSchema,
  submitApprovalSchema,
} from './dto/payroll-calculations.schemas';
import { PayrollCalculationsService } from './payroll-calculations.service';

const uuidParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('payroll')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class PayrollCalculationsController {
  constructor(private readonly payrollService: PayrollCalculationsService) {}

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントIDが特定できません');
    }
    return tenantId;
  }

  private requireUserId(): string {
    const userId = RequestContext.getUserId();
    if (!userId) {
      throw AppException.unauthorized('ユーザーIDが特定できません');
    }
    return userId;
  }

  // ==========================================================================
  // 1. 給与プロファイル (profiles)
  // ==========================================================================

  @Post('profiles')
  @RequirePermissions('payroll.create')
  async createProfile(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const input = parseWithZod(createPayrollProfileSchema, body);
    const profile = await this.payrollService.createProfile(tenantId, userId, input);
    return successEnvelope(profile);
  }

  @Put('profiles/:id/close')
  @RequirePermissions('payroll.create')
  async closeProfile(@Param('id') idParam: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const profileId = parseWithZod(uuidParamSchema, idParam);
    const input = parseWithZod(closePayrollProfileSchema, body);
    const profile = await this.payrollService.closeProfile(tenantId, userId, profileId, input);
    return successEnvelope(profile);
  }

  @Get('profiles/employee/:employeeId')
  @RequirePermissions('payroll.view')
  async getProfilesByEmployee(@Param('employeeId') empParam: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const employeeId = parseWithZod(uuidParamSchema, empParam);
    const profiles = await this.payrollService.getProfilesByEmployee(tenantId, userId, employeeId);
    return successEnvelope(profiles);
  }

  // ==========================================================================
  // 2. 給与計算期間 (periods)
  // ==========================================================================

  @Post('periods')
  @RequirePermissions('payroll.create')
  async createPeriod(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const input = parseWithZod(createPayrollPeriodSchema, body);
    const period = await this.payrollService.createPeriod(tenantId, userId, input);
    return successEnvelope(period);
  }

  @Get('periods')
  @RequirePermissions('payroll.view')
  async listPeriods() {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const periods = await this.payrollService.listPeriods(tenantId, userId);
    return successEnvelope(periods);
  }

  @Get('periods/:id')
  @RequirePermissions('payroll.view')
  async getPeriod(@Param('id') idParam: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const periodId = parseWithZod(uuidParamSchema, idParam);
    const period = await this.payrollService.getPeriod(tenantId, userId, periodId);
    return successEnvelope(period);
  }

  // ==========================================================================
  // 3. 給与計算エンジン (calculations)
  // ==========================================================================

  @Post('periods/:id/calculate')
  @RequirePermissions('payroll.create')
  async calculateForPeriod(@Param('id') idParam: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const periodId = parseWithZod(uuidParamSchema, idParam);
    const input = parseWithZod(calculatePayrollSchema, body);
    const calculations = await this.payrollService.calculateForPeriod(tenantId, userId, periodId, input);
    return successEnvelope(calculations);
  }

  @Get('periods/:id/calculations')
  @RequirePermissions('payroll.view')
  async listCalculations(@Param('id') idParam: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const periodId = parseWithZod(uuidParamSchema, idParam);
    const calculations = await this.payrollService.listCalculations(tenantId, userId, periodId);
    return successEnvelope(calculations);
  }

  @Get('calculations/:id')
  @RequirePermissions('payroll.view')
  async getCalculation(@Param('id') idParam: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const calcId = parseWithZod(uuidParamSchema, idParam);
    const calculation = await this.payrollService.getCalculation(tenantId, userId, calcId);
    return successEnvelope(calculation);
  }

  // ==========================================================================
  // 4. 承認申請 (approval submission)
  // ==========================================================================

  @Post('calculations/:id/submit-approval')
  @RequirePermissions('payroll.create')
  async submitApproval(@Param('id') idParam: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const calcId = parseWithZod(uuidParamSchema, idParam);
    const input = parseWithZod(submitApprovalSchema, body);
    const calculation = await this.payrollService.submitApproval(tenantId, userId, calcId, input);
    return successEnvelope(calculation);
  }

  @Post('periods/:id/submit-approval')
  @RequirePermissions('payroll.create')
  async submitPeriodApproval(@Param('id') idParam: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const periodId = parseWithZod(uuidParamSchema, idParam);
    const input = parseWithZod(submitApprovalSchema, body);
    const result = await this.payrollService.submitPeriodApproval(tenantId, userId, periodId, input);
    return successEnvelope(result);
  }
}
