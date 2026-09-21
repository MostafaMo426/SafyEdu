import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CanteenCartItemDto {
  @ApiProperty({
    description: 'CanteenItem UUID',
    example: 'a1b07384-d113-40a2-97b7-5f6e61234567',
  })
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({
    description: 'Quantity to purchase',
    example: 2,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  qty: number;
}

export class CanteenPurchaseRequestDto {
  @ApiProperty({
    description: 'Physical NFC card UID tapped on POS reader',
    example: '04:A2:5B:1A:89:6C:80',
  })
  @IsString()
  @IsNotEmpty()
  studentNfcUid: string;

  @ApiProperty({
    description: 'List of items and quantities being purchased',
    type: [CanteenCartItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CanteenCartItemDto)
  items: CanteenCartItemDto[];

  @ApiPropertyOptional({
    description: 'Optional cashier / canteen operator User UUID',
    example: 'op_123',
  })
  @IsOptional()
  @IsString()
  operatorId?: string;
}
