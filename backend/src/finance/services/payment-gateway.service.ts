import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';

export interface PaymentIntentResult {
  gatewayRef: string;
  orderId: string;
  paymentMethod: PaymentMethod;
  amountEGP: number;
  paymentLink?: string;
  referenceCode?: string;
  expiresAt: Date;
  instructions: string;
}

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Generates simulated payment credentials for Egyptian payment providers.
   * Supports Paymob Cards/Wallets, Fawry Kiosks, and InstaPay (IPN).
   */
  async createPaymentIntent(
    method: PaymentMethod,
    amountEGP: number,
    studentId: string,
    metadata: Record<string, any> = {},
  ): Promise<PaymentIntentResult> {
    const timestamp = Date.now();
    const randomHex = Math.random().toString(36).substring(2, 8);

    if (
      method === PaymentMethod.PAYMOB_CARD ||
      method === PaymentMethod.PAYMOB_WALLET ||
      method === PaymentMethod.CARD
    ) {
      const orderId = `pm_ord_${timestamp}_${randomHex}`;
      const token = `pt_${Math.random().toString(36).substring(2, 12)}`;
      const paymentLink = `https://accept.paymob.com/api/acceptance/iframes/mock?payment_token=${token}&amount=${amountEGP}`;
      const expiresAt = new Date(timestamp + 30 * 60 * 1000); // 30 mins

      this.logger.log(`Created Paymob payment intent: ${orderId} (${amountEGP} EGP)`);

      return {
        gatewayRef: orderId,
        orderId,
        paymentMethod: method,
        amountEGP,
        paymentLink,
        expiresAt,
        instructions:
          'Redirect the user to paymentLink to complete transaction via Paymob 3D-Secure iframe.',
      };
    }

    if (method === PaymentMethod.FAWRY) {
      // Standard 9-digit Egyptian Fawry merchant payment reference
      const referenceCode = `987${Math.floor(100000 + Math.random() * 900000)}`;
      const orderId = `fawry_ord_${timestamp}_${randomHex}`;
      const expiresAt = new Date(timestamp + 48 * 60 * 60 * 1000); // 48 hours

      this.logger.log(`Created Fawry kiosk reference: ${referenceCode} (${amountEGP} EGP)`);

      return {
        gatewayRef: orderId,
        orderId,
        paymentMethod: method,
        amountEGP,
        referenceCode,
        expiresAt,
        instructions: `Pay at any Fawry / Aman / Masary kiosk within 48 hours using SafyEdu Service Code 788 and Reference Number: ${referenceCode}.`,
      };
    }

    if (method === PaymentMethod.INSTAPAY) {
      const referenceCode = `IPN-${timestamp.toString().slice(-8)}`;
      const orderId = `ipn_ord_${timestamp}_${randomHex}`;
      const expiresAt = new Date(timestamp + 24 * 60 * 60 * 1000);

      this.logger.log(`Created InstaPay reference: ${referenceCode} (${amountEGP} EGP)`);

      return {
        gatewayRef: orderId,
        orderId,
        paymentMethod: method,
        amountEGP,
        referenceCode,
        expiresAt,
        instructions: `Transfer exactly ${amountEGP} EGP using the InstaPay application to IPA: safyedu@instapay. You MUST include reference "${referenceCode}" in the transfer notes.`,
      };
    }

    // Default fallback
    const orderId = `generic_ord_${timestamp}_${randomHex}`;
    return {
      gatewayRef: orderId,
      orderId,
      paymentMethod: method,
      amountEGP,
      expiresAt: new Date(timestamp + 3600 * 1000),
      instructions: `Please proceed to complete payment with method ${method}.`,
    };
  }
}
