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
import {
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeUpdateSchema,
} from './dto/employee.schemas';
import { EmployeesService } from './employees.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('employees')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

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

  @Get()
  @RequirePermissions('employee.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(employeeListQuerySchema, query);
    const { employees, pagination } = await this.employeesService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(employees, pagination);
  }

  @Get(':id')
  @RequirePermissions('employee.view')
  async getById(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const id = parseWithZod(idParamSchema, idParam);
    const employee = await this.employeesService.getById(
      tenantId,
      RequestContext.getUserId(),
      id,
    );
    return successEnvelope(employee);
  }

  @Post()
  @RequirePermissions('employee.create')
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const input = parseWithZod(employeeCreateSchema, body);
    const employee = await this.employeesService.create(tenantId, userId, input);
    return successEnvelope(employee);
  }

  @Put(':id')
  @RequirePermissions('employee.edit')
  async update(@Param('id') idParam: unknown, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const input = parseWithZod(employeeUpdateSchema, body);
    const employee = await this.employeesService.update(
      tenantId,
      userId,
      id,
      input,
    );
    return successEnvelope(employee);
  }
}
