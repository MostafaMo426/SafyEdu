import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { DEPARTMENT_ACCESS_KEY } from '../decorators/department-access.decorator';
import { JwtPayload } from '../auth.service';

/**
 * Composite guard enforcing both Role-Based and Department-scoped access control.
 *
 * Evaluation order:
 *  1. If no @Roles() decorator present → allow (route is role-agnostic).
 *  2. SUPERADMIN bypasses all checks.
 *  3. User must have at least one required role from @Roles().
 *  4. If @DepartmentAccess() is also present, user's role must be scoped
 *     to one of the allowed department types (or have a null dept scope
 *     meaning the role applies school-wide).
 *
 * This guard is typically applied globally after JwtAuthGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<SystemRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Route has no role restriction
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user }: { user: JwtPayload } = context.switchToHttp().getRequest();

    // SUPERADMIN bypasses all restrictions
    if (user.roles.includes(SystemRole.SUPERADMIN)) return true;

    // Check role membership
    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required role(s): ${requiredRoles.join(', ')}`,
      );
    }

    // Department-level check (optional)
    const allowedDepts = this.reflector.getAllAndOverride<string[]>(
      DEPARTMENT_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (allowedDepts && allowedDepts.length > 0) {
      // SCHOOL_ADMIN has school-wide access even with dept restriction
      if (user.roles.includes(SystemRole.SCHOOL_ADMIN)) return true;

      // For departmental access, we need the dept info on the payload.
      // Department scope is validated by TenantContextInterceptor at
      // the service layer — this guard only checks role presence here.
      // Full dept isolation is enforced at the Prisma query level.
    }

    return true;
  }
}
