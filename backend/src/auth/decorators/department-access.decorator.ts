import { SetMetadata } from '@nestjs/common';

export const DEPARTMENT_ACCESS_KEY = 'departmentAccess';

/**
 * Restricts route access to users whose UserRole is scoped to
 * one of the specified DepartmentType values.
 * SUPERADMIN and SCHOOL_ADMIN bypass this check.
 *
 * Usage:
 *   @DepartmentAccess('IGCSE', 'AMERICAN')
 *   @Get('igcse-reports')
 *   getIgcseReports() { ... }
 */
export const DepartmentAccess = (...depts: string[]) =>
  SetMetadata(DEPARTMENT_ACCESS_KEY, depts);
