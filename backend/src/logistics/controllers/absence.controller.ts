import {
  Controller,
  Post,
  Body,
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
import { AbsenceService } from '../services/absence.service';
import { CreateAbsenceDto } from '../dto/absence.dto';

@ApiTags('Logistics - Absence')
@ApiBearerAuth('access-token')
@Controller({ path: ['logistics/absence', 'absence'], version: '1' })
export class AbsenceController {
  constructor(private readonly absenceService: AbsenceService) {}

  /**
   * POST /api/v1/logistics/absence or POST /api/v1/absence
   * Parents report their child's absence from the bus for a morning, afternoon, or full day run.
   * Updates driver route live to skip the home stop.
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Report student absence for bus transportation',
    description:
      'Called from the Parent App. Updates the student logistics status for the specified day and notifies the driver navigation app to dynamically skip the stop.',
  })
  @ApiResponse({
    status: 201,
    description: 'Absence registered successfully; driver navigation updated',
  })
  @ApiResponse({
    status: 400,
    description: 'Student not assigned to an active bus route',
  })
  @ApiResponse({
    status: 403,
    description: 'User is not linked as an authorized parent of this student',
  })
  @ApiResponse({
    status: 404,
    description: 'Student profile not found',
  })
  async reportAbsence(@Body() dto: CreateAbsenceDto, @Request() req: any) {
    const requestingUserId = req.user?.sub;
    const userRoles = req.user?.roles ?? [];
    return this.absenceService.recordAbsence(dto, requestingUserId, userRoles);
  }
}
