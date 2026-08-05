import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { departmentCreateSchema } from './dto/department.schemas';
import { DepartmentsService } from './departments.service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
});

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 部門マスタCRUD(`docs/openapi.yaml` `tags: [Departments]`) */
@Controller('departments')
@UseGuards(TenantAuthGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(listQuerySchema, query);
    const { departments, pagination } = await this.departmentsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(departments, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(departmentCreateSchema, body);
    const department = await this.departmentsService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(department);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(departmentCreateSchema, body);
    const department = await this.departmentsService.update(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
      dto,
    );
    return successEnvelope(department);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
