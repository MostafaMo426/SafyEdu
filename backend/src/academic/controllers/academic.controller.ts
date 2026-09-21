import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GradeService } from '../services/grade.service';
import { SubstitutionService } from '../services/substitution.service';
import { RecordGradeDto } from '../dto/grade.dto';
import { TeacherAbsenceRequestDto } from '../dto/substitution.dto';

@ApiTags('Academic - Gradebook & Substitution Engine')
@Controller({ path: 'academic', version: '1' })
export class AcademicController {
  constructor(
    private readonly gradeService: GradeService,
    private readonly substitutionService: SubstitutionService,
  ) {}

  /**
   * GET /api/v1/academic/grades/:studentId/:subjectId/:termId
   * Computes curriculum-specific term grade dynamically branching by department track:
   * - American: 4.0 GPA scale & letter grade (e.g. 93-100 = 4.0 / A)
   * - British (IGCSE): Cambridge / Edexcel grade boundaries (A*, A, B, C, D, E, U)
   * - National: Egyptian MoE requirements (First Term, Second Term, Year Total with Egyptian appreciation ratings)
   */
  @Get('grades/:studentId/:subjectId/:termId')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate curriculum-specific term grade',
    description:
      'Dynamically calculates term grades branching by American (4.0 GPA), IGCSE (Cambridge letter grades), or Egyptian National (MoE ratings & Year Totals).',
  })
  @ApiParam({ name: 'studentId', description: 'Student User ID' })
  @ApiParam({ name: 'subjectId', description: 'Subject ID' })
  @ApiParam({ name: 'termId', description: 'Academic Term ID' })
  @ApiResponse({ status: 200, description: 'Calculated curriculum grade result' })
  @ApiResponse({ status: 404, description: 'Subject, Term, or Student not found' })
  async calculateTermGrade(
    @Param('studentId') studentId: string,
    @Param('subjectId') subjectId: string,
    @Param('termId') termId: string,
  ) {
    return this.gradeService.calculateTermGrade(studentId, subjectId, termId);
  }

  /**
   * POST /api/v1/academic/grades
   * Records or updates a grade for a specific assessment.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('grades')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record student assessment grade',
    description: 'Records assessment marks and auto-derives the letter grade.',
  })
  @ApiResponse({ status: 200, description: 'Grade recorded successfully' })
  async recordGrade(@Body() dto: RecordGradeDto) {
    return this.gradeService.recordGrade(dto);
  }

  /**
   * POST /api/v1/academic/absence/teacher
   * Al-Ihtiyat (الاحتياط) Automated Teacher Substitution Engine:
   * When a teacher calls in sick, queries their timetable slots for that day,
   * finds substitute teachers in the same department with subject qualifications and free periods,
   * creates substitution records, and fires real-time mobile push notifications.
   */
  @Post('absence/teacher')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report teacher absence and auto-assign substitutions (Al-Ihtiyat)',
    description:
      'Queries absent teacher timetable slots, automatically discovers and assigns qualified substitutes with free periods in the same department, and emits push alerts.',
  })
  @ApiResponse({ status: 200, description: 'Substitution assignments generated' })
  @ApiResponse({ status: 404, description: 'Teacher profile not found' })
  async handleTeacherAbsence(@Body() dto: TeacherAbsenceRequestDto) {
    return this.substitutionService.handleTeacherAbsence(dto);
  }
}
