import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
} from 'class-validator';

export class UpdateDietaryRestrictionsDto {
  @ApiProperty({
    description: 'Student UUID or StudentProfile UUID',
    example: 'c1b07384-d113-40a2-97b7-5f6e61234567',
  })
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @ApiPropertyOptional({
    description: 'Daily canteen spending cap in EGP (0 = no limit)',
    example: 75,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyLimit?: number;

  @ApiPropertyOptional({
    description: 'Array of blocked CanteenCategory UUIDs (e.g., Candies, Sodas)',
    example: ['d3b07384-d113-40a2-97b7-5f6e61234567'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedCategoryIds?: string[];

  @ApiPropertyOptional({
    description: 'Array of blocked specific CanteenItem UUIDs',
    example: ['e4b07384-d113-40a2-97b7-5f6e61234567'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedItemIds?: string[];

  @ApiPropertyOptional({
    description: 'Dietary allergen keywords or prohibited search terms (e.g. Peanuts, Soda, Red Bull)',
    example: ['Peanuts', 'Soda', 'Energy Drink'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedKeywords?: string[];
}
