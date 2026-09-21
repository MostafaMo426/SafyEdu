import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletService } from './services/wallet.service';
import { PaymentGatewayService } from './services/payment-gateway.service';
import { PaymentController } from './controllers/payment.controller';
import { WebhookController } from './controllers/webhook.controller';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentController, WebhookController],
  providers: [WalletService, PaymentGatewayService],
  exports: [WalletService, PaymentGatewayService],
})
export class FinanceModule {}
