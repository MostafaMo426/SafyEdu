import { SetMetadata } from '@nestjs/common';
import { SystemRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Attach required roles to a controller or route handler.
 * Works in conjunction with RolesGuard.
 *
 * Usage:
 *   @Roles(SystemRole.SCHOOL_ADMIN, SystemRole.HEAD_OF_DEPARTMENT)
 *   @Get('reports')
 *   getReports() { ... }
 */
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES_KEY, roles);
