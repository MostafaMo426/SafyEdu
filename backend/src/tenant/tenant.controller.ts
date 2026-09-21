import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SystemRole } from '@prisma/client';

@ApiTags('Tenants')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'tenants', version: '1' })
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Roles(SystemRole.SUPERADMIN)
  @Post()
  @ApiOperation({ summary: '[SUPERADMIN] Create a new school tenant' })
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Roles(SystemRole.SUPERADMIN)
  @Get()
  @ApiOperation({ summary: '[SUPERADMIN] List all school tenants' })
  findAll() {
    return this.tenants.findAll();
  }

  @Roles(SystemRole.SUPERADMIN, SystemRole.SCHOOL_ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Get tenant details by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.findOne(id);
  }

  @Roles(SystemRole.SUPERADMIN, SystemRole.SCHOOL_ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Update tenant settings' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.tenants.update(id, dto);
  }

  @Roles(SystemRole.SUPERADMIN)
  @Delete(':id')
  @ApiOperation({ summary: '[SUPERADMIN] Soft-archive (deactivate) a tenant' })
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.archive(id);
  }
}
