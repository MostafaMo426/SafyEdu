import {
  Controller,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemRole } from '@prisma/client';
import { FleetService } from '../services/fleet.service';
import { ActiveFleetItemDto } from '../dto/fleet.dto';

@ApiTags('Logistics - Fleet Control Room')
@ApiBearerAuth('access-token')
@Controller({ path: ['logistics', 'fleet'], version: '1' })
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  /**
   * GET /api/v1/logistics/active-fleet or GET /api/v1/fleet/active-fleet
   * Restricted to SCHOOL_ADMIN and SUPERADMIN.
   * Returns a flat JSON array of all buses with real-time GPS coordinates
   * and live passenger counts for Next.js / MapLibre visualization.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SystemRole.SCHOOL_ADMIN, SystemRole.SUPERADMIN)
  @Get('active-fleet')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve active fleet coordinates and passenger occupancy',
    description:
      'High-performance endpoint combining PostgreSQL route/boarding records with Redis live telemetry MGET. Optimized for MapLibre Web GL map rendering.',
  })
  @ApiResponse({
    status: 200,
    description: 'Flat list of active buses with GPS coordinates and student counts',
    type: [ActiveFleetItemDto],
  })
  @ApiResponse({
    status: 403,
    description: 'Requires SCHOOL_ADMIN or SUPERADMIN privileges',
  })
  async getActiveFleet(@Request() req: any): Promise<ActiveFleetItemDto[]> {
    const tenantId = req.user?.tenantId ?? null;
    return this.fleetService.getActiveFleet(tenantId);
  }
}
