import { Controller, Post, Body, HttpCode, HttpStatus, Version } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WalletService } from '../services/wallet.service';
import { PaymobWebhookDto } from '../dto/topup.dto';

@ApiTags('Finance - Payment Webhooks')
@Controller({ path: 'webhooks', version: '1' })
export class WebhookController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * POST /api/v1/webhooks/paymob or /webhooks/paymob
   */
  @Post('paymob')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paymob webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Processed successfully' })
  async handlePaymob(@Body() dto: PaymobWebhookDto) {
    const amountEGP = dto.amountCents / 100;
    const ref = dto.gatewayRef || dto.orderId;
    return this.walletService.processWebhookConfirmation(ref, amountEGP, dto);
  }

  /**
   * POST /api/v1/webhooks/fawry or /webhooks/fawry
   */
  @Post('fawry')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fawry kiosk webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Processed successfully' })
  async handleFawry(@Body() payload: { orderId: string; amountEGP: number }) {
    return this.walletService.processWebhookConfirmation(
      payload.orderId,
      payload.amountEGP,
      payload,
    );
  }
}
