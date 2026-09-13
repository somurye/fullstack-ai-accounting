import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
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
import { AttendanceService } from './attendance.service';
import {
  attendanceListQuerySchema,
  attendanceRecordCreateSchema,
  attendanceRecordUpdateSchema,
  clockActionSchema,
} from './dto/attendance.schemas';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('attendance')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

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
      throw AppException.unauthorized('ユーザー認証が必要です');
    }
    return userId;
  }

  /**
   * 打刻API (出勤 / 退勤)
   */
  @Post('clock')
  @RequirePermissions('attendance.create')
  async clock(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const input = parseWithZod(clockActionSchema, body);
    const result = await this.attendanceService.clock(tenantId, userId, input);
    return successEnvelope(result);
  }

  /**
   * 勤怠レコード手動作成
   */
  @Post('records')
  @RequirePermissions('attendance.create')
  async createRecord(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const input = parseWithZod(attendanceRecordCreateSchema, body);
    const result = await this.attendanceService.createRecord(tenantId, userId, input);
    return successEnvelope(result);
  }

  /**
   * 勤怠レコード一覧取得
   */
  @Get('records')
  @RequirePermissions('attendance.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const parsedQuery = parseWithZod(attendanceListQuerySchema, query);
    const { records, pagination } = await this.attendanceService.list(
      tenantId,
      userId,
      parsedQuery,
    );
    return successEnvelope(records, pagination);
  }

  /**
   * 勤怠レコード詳細取得
   */
  @Get('records/:id')
  @RequirePermissions('attendance.view')
  async getById(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const record = await this.attendanceService.getById(tenantId, userId, id);
    return successEnvelope(record);
  }

  /**
   * 勤怠レコード手動更新
   */
  @Put('records/:id')
  @RequirePermissions('attendance.edit')
  async updateRecord(@Param('id') idParam: unknown, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const input = parseWithZod(attendanceRecordUpdateSchema, body);
    const result = await this.attendanceService.updateRecord(
      tenantId,
      userId,
      id,
      input,
    );
    return successEnvelope(result);
  }
}
