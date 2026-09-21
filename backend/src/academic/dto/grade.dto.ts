import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class CalculateGradeDto {
  @ApiProperty({ description: 'Student User ID', format: 'uuid' })
  @IsUUID()
  studentId: string;

  @ApiProperty({ description: 'Subject ID', format: 'uuid' })
  @IsUUID()
  subjectId: string;

  @ApiProperty({ description: 'Academic Term ID', format: 'uuid' })
  @IsUUID()
  termId: string;
}

export class RecordGradeDto {
  @ApiProperty({ description: 'Assessment ID', format: 'uuid' })
  @IsUUID()
  assessmentId: string;

  @ApiProperty({ description: 'Student User ID', format: 'uuid' })
  @IsUUID()
  studentId: string;

  @ApiProperty({ description: 'Marks obtained by student', example: 88.5 })
  @IsNumber()
  @Min(0)
  marksObtained: number;

  @ApiPropertyOptional({ description: 'Optional feedback / notes' })
  @IsOptional()
  @IsString()
  comments?: string;
}

export interface AssessmentScoreBreakdown {
  assessmentId: string;
  title: string;
  marksObtained: number;
  totalMarks: number;
  weight: number;
  percentage: number;
}

export interface AmericanGradeResult {
  track: 'AMERICAN';
  studentId: string;
  subjectId: string;
  subjectNameEn: string;
  subjectNameAr: string;
  termId: string;
  termLabel: string;
  percentage: number;
  gpa: number;
  letterGrade: string;
  assessmentsCount: number;
  breakdown: AssessmentScoreBreakdown[];
}

export interface IGCSEGradeResult {
  track: 'IGCSE';
  studentId: string;
  subjectId: string;
  subjectNameEn: string;
  subjectNameAr: string;
  termId: string;
  termLabel: string;
  percentage: number;
  letterGrade: string; // A*, A, B, C, D, E, U
  cambridgeBoundary: string;
  assessmentsCount: number;
  breakdown: AssessmentScoreBreakdown[];
}

export interface NationalGradeResult {
  track: 'NATIONAL';
  studentId: string;
  subjectId: string;
  subjectNameEn: string;
  subjectNameAr: string;
  termId: string;
  termLabel: string;
  termType: string;
  percentage: number;
  ratingAr: string; // ممتاز, جيد جداً, جيد, مقبول, دون المستوى
  ratingEn: string; // Excellent, Very Good, Good, Pass, Below Standard
  letterGrade?: string;
  passed: boolean;
  firstTermPercentage?: number;
  secondTermPercentage?: number;
  yearTotalPercentage?: number;
  yearRatingAr?: string;
  yearRatingEn?: string;
  assessmentsCount: number;
  breakdown: AssessmentScoreBreakdown[];
}

export type TermGradeResult = AmericanGradeResult | IGCSEGradeResult | NationalGradeResult;
