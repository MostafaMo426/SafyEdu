import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { BoardingStatus } from '@prisma/client';

export enum BoardingDirection {
  PICKUP_TO_SCHOOL = 'PICKUP_TO_SCHOOL',
  DROPOFF_TO_HOME = 'DROPOFF_TO_HOME',
}

export class BoardDto {
  @ApiProperty({
    description: 'Physical NFC Card UID scanned from the student card',
    example: '04:A2:5B:1A:89:6C:80',
  })
  @IsString()
  @IsNotEmpty()
  studentNfcUid: string;

  @ApiProperty({
    description: 'Bus Route ID (UUID) or Vehicle identifier',
    example: 'd3b07384-d113-40a2-97b7-5f6e61234567',
  })
  @IsString()
  @IsNotEmpty()
  busId: string;

  @ApiProperty({
    description: 'Latitude where the NFC tap occurred',
    example: 30.04442,
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({
    description: 'Longitude where the NFC tap occurred',
    example: 31.23571,
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({
    description: 'Explicit boarding status (defaults to smart toggle: BOARDED or ALIGHTED)',
    enum: BoardingStatus,
    example: BoardingStatus.BOARDED,
  })
  @IsOptional()
  @IsEnum(BoardingStatus)
  status?: BoardingStatus;

  @ApiPropertyOptional({
    description: 'Trip direction',
    enum: BoardingDirection,
    example: BoardingDirection.PICKUP_TO_SCHOOL,
  })
  @IsOptional()
  @IsEnum(BoardingDirection)
  direction?: BoardingDirection;
}
