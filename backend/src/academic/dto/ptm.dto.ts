import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString, IsDateString, IsEnum, IsBoolean } from 'class-validator';
import { PTMMode, PTMStatus } from '@prisma/client';

export class BookPtmSlotDto {
  @ApiProperty({
    description: 'PTM Slot ID to book',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsUUID()
  slotId: string;

  @ApiProperty({
    description: 'Student User ID being discussed during the conference',
    format: 'uuid',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @IsUUID()
  studentId: string;

  @ApiPropertyOptional({
    description: 'Parent User ID (overridden by authenticated JWT user if present)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Topics or questions the parent wishes to discuss',
    example: 'Inquire regarding math quiz performance and homework habits',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePtmCycleDto {
  @ApiProperty({ description: 'Academic Term ID', format: 'uuid' })
  @IsUUID()
  termId: string;

  @ApiProperty({ description: 'Cycle Title', example: 'Term 1 Parent-Teacher Conference' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Conference Date (YYYY-MM-DD)', example: '2026-10-15' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ enum: PTMMode, default: PTMMode.PHYSICAL })
  @IsOptional()
  @IsEnum(PTMMode)
  mode?: PTMMode;

  @ApiPropertyOptional({ description: 'Venue or online link' })
  @IsOptional()
  @IsString()
  venueInfo?: string;

  @ApiPropertyOptional({ description: 'Is cycle open for booking?', default: true })
  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}

export class CreatePtmSlotDto {
  @ApiProperty({ description: 'PTM Cycle ID', format: 'uuid' })
  @IsUUID()
  cycleId: string;

  @ApiProperty({ description: 'Teacher User ID', format: 'uuid' })
  @IsUUID()
  teacherId: string;

  @ApiProperty({ description: 'Slot start time ISO datetime', example: '2026-10-15T09:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ description: 'Slot end time ISO datetime (10 min later)', example: '2026-10-15T09:10:00.000Z' })
  @IsDateString()
  endTime: string;

  @ApiPropertyOptional({ description: 'Meeting link if online' })
  @IsOptional()
  @IsString()
  meetingUrl?: string;
}
