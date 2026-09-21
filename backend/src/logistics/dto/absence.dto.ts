import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  Matches,
} from 'class-validator';

export enum AbsenceRound {
  MORNING = 'MORNING',
  AFTERNOON = 'AFTERNOON',
  FULL_DAY = 'FULL_DAY',
}

export class CreateAbsenceDto {
  @ApiProperty({
    description: 'Student UUID or StudentProfile UUID',
    example: 'c1b07384-d113-40a2-97b7-5f6e61234567',
  })
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @ApiPropertyOptional({
    description: 'Date of absence in YYYY-MM-DD format (defaults to current date)',
    example: '2026-09-22',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in YYYY-MM-DD format',
  })
  date?: string;

  @ApiPropertyOptional({
    description: 'Reason for absence',
    example: 'Child has a doctor appointment',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Which bus route round the student will skip',
    enum: AbsenceRound,
    default: AbsenceRound.FULL_DAY,
  })
  @IsOptional()
  @IsEnum(AbsenceRound)
  round?: AbsenceRound = AbsenceRound.FULL_DAY;
}
