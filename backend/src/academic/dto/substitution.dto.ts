import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsDateString, IsOptional, IsUrl, IsString } from 'class-validator';

export class TeacherAbsenceRequestDto {
  @ApiProperty({
    description: 'User ID of the absent teacher',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsUUID()
  absentTeacherId: string;

  @ApiProperty({
    description: 'Date of absence in YYYY-MM-DD format',
    example: '2026-09-22',
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description: 'URL to the lesson plan to be shared with substitute teachers',
    example: 'https://docs.safyedu.com/plans/math-algebra-week4.pdf',
  })
  @IsOptional()
  @IsUrl()
  lessonPlanUrl?: string;

  @ApiPropertyOptional({
    description: 'Additional instructions or handoff notes for the substitute',
    example: 'Please have students solve page 42 exercises 1-10.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export interface SubstitutionAssignmentResult {
  timetableSlotId: string;
  periodNumber: number;
  time: string;
  classroomId: string;
  classroomSection: string;
  subjectId: string;
  subjectName: string;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  status: 'AUTO_ASSIGNED' | 'ACCEPTED' | 'PENDING' | 'UNASSIGNED';
  substitutionId?: string;
  reason?: string;
}

export interface TeacherAbsenceResponse {
  absentTeacherId: string;
  absentTeacherName: string;
  date: string;
  dayOfWeek: number;
  totalSlots: number;
  coveredSlots: number;
  uncoveredSlots: number;
  assignments: SubstitutionAssignmentResult[];
}
