import {
  Controller,
  Post,
  Get,
  Body,
  Param,
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
import { WalletService } from '../services/wallet.service';
import { TopUpRequestDto, PaymobWebhookDto } from '../dto/topup.dto';

@ApiTags('Finance - Wallet & Payments')
@Controller({ path: 'wallet', version: '1' })
export class PaymentController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * POST /api/v1/wallet/topup
   * Allows a parent to initiate a digital wallet top-up for tuition or canteen spending.
   * Generates gateway instructions (Paymob iframe link, Fawry reference code, or InstaPay IPA).
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('topup')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate a wallet top-up',
    description:
      'Creates a pending double-entry transaction and returns Egyptian payment gateway instructions (Paymob, Fawry kiosk code, or InstaPay).',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment intent generated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Student profile or wallet not found',
  })
  async initiateTopUp(@Body() dto: TopUpRequestDto, @Request() req: any) {
    const requestingUserId = req.user?.sub;
    return this.walletService.initiateTopUp(
      dto.studentId,
      dto.amountEGP,
      dto.paymentMethod,
      requestingUserId,
    );
  }

  /**
   * POST /api/v1/wallet/webhooks/paymob (and /webhooks/paymob)
   * Receives payment completion notifications from Paymob.
   * Atomically credits the student wallet and logs confirmed double-entry ledger entry.
   */
  @Post('webhooks/paymob')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paymob gateway webhook listener',
    description:
      'Invoked by Paymob servers upon transaction completion. Idempotent and credits the student wallet balance.',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed and wallet credited' })
  async handlePaymobWebhook(@Body() dto: PaymobWebhookDto) {
    const amountEGP = dto.amountCents / 100;
    const ref = dto.gatewayRef || dto.orderId;
    return this.walletService.processWebhookConfirmation(ref, amountEGP, dto);
  }

  /**
   * POST /api/v1/wallet/webhooks/fawry
   * Receives payment confirmation when cash is collected at a Fawry kiosk.
   */
  @Post('webhooks/fawry')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fawry kiosk webhook listener',
    description: 'Invoked by Fawry servers when cash is paid at an Egyptian retail terminal.',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed and wallet credited' })
  async handleFawryWebhook(@Body() payload: { orderId: string; amountEGP: number }) {
    return this.walletService.processWebhookConfirmation(
      payload.orderId,
      payload.amountEGP,
      payload,
    );
  }

  /**
   * GET /api/v1/wallet/:studentId
   * Retrieves student wallet balance, daily limits, and recent transaction history.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Get(':studentId')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get student wallet balance and ledger history' })
  @ApiResponse({ status: 200, description: 'Returns wallet details and recent transactions' })
  async getWallet(@Param('studentId') studentId: string) {
    return this.walletService.getWallet(studentId);
  }
}
