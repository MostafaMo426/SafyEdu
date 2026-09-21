import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class TopUpRequestDto {
  @ApiProperty({
    description: 'Student UUID or StudentProfile UUID to top up',
    example: 'c1b07384-d113-40a2-97b7-5f6e61234567',
  })
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({
    description: 'Amount in Egyptian Pounds (EGP)',
    example: 250,
    minimum: 10,
    maximum: 50000,
  })
  @IsNumber()
  @Min(10, { message: 'Minimum top-up amount is 10 EGP' })
  @Max(50000, { message: 'Maximum top-up amount is 50,000 EGP per transaction' })
  amountEGP: number;

  @ApiProperty({
    description: 'Selected payment gateway method',
    enum: PaymentMethod,
    example: PaymentMethod.PAYMOB_CARD,
  })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}

export class PaymobWebhookDto {
  @ApiProperty({ example: 'pm_ord_1726938000000_abc123' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ example: 'tx_987654321' })
  @IsString()
  @IsNotEmpty()
  transactionId: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiProperty({ example: 25000, description: 'Amount in cents or piasters' })
  @IsNumber()
  amountCents: number;

  @ApiPropertyOptional({ example: 'REF-FAWRY-987123456' })
  @IsOptional()
  @IsString()
  gatewayRef?: string;

  @ApiPropertyOptional({ example: 'sha256_hmac_hash' })
  @IsOptional()
  @IsString()
  hmac?: string;
}
