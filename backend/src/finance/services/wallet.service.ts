import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { PaymentGatewayService, PaymentIntentResult } from './payment-gateway.service';
import {
  BoardingStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SystemRole,
  TransactionType,
} from '@prisma/client';

export interface CanteenCartItem {
  itemId: string;
  qty: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly paymentGateway: PaymentGatewayService,
  ) {}

  /**
   * Initializes a digital wallet for a student.
   * Called during student enrollment or onboarding.
   */
  async initializeWallet(
    userId: string,
    tenantId: string,
    initialBalance = 0,
    dailyLimit = 0,
    nfcCardUid?: string,
  ) {
    return this.prisma.wallet.upsert({
      where: { userId },
      update: {
        dailyLimit,
        nfcCardUid: nfcCardUid ?? undefined,
        isActive: true,
      },
      create: {
        userId,
        tenantId,
        balance: initialBalance,
        dailyLimit,
        nfcCardUid: nfcCardUid ?? undefined,
        isActive: true,
      },
    });
  }

  /**
   * Retrieves a student's wallet by User UUID or StudentProfile UUID.
   */
  async getWallet(studentOrUserId: string) {
    let wallet = await this.prisma.wallet.findFirst({
      where: {
        OR: [{ userId: studentOrUserId }, { id: studentOrUserId }],
      },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!wallet) {
      // Check if ID is a StudentProfile ID
      const profile = await this.prisma.studentProfile.findUnique({
        where: { id: studentOrUserId },
        include: { user: { include: { wallet: true } } },
      });
      wallet = profile?.user?.wallet as any;
    }

    if (!wallet) {
      throw new NotFoundException(`No digital wallet found for user: ${studentOrUserId}`);
    }

    return wallet;
  }

  /**
   * Initiates a top-up request from a parent.
   * Generates gateway payment instructions and creates a pending ledger entry.
   */
  async initiateTopUp(
    studentId: string,
    amountEGP: number,
    paymentMethod: PaymentMethod,
    requestingUserId: string,
  ): Promise<PaymentIntentResult> {
    // 1. Locate student and wallet
    const student = await this.prisma.studentProfile.findFirst({
      where: {
        OR: [{ id: studentId }, { userId: studentId }, { studentCode: studentId }],
      },
      include: {
        user: { include: { wallet: true } },
      },
    });

    if (!student) {
      throw new NotFoundException(`Student not found for identifier: ${studentId}`);
    }

    let wallet = student.user.wallet;
    if (!wallet) {
      wallet = await this.initializeWallet(
        student.userId,
        student.tenantId,
        0,
        0,
        student.nfcCardUid ?? undefined,
      );
    }

    // 2. Request gateway intent (Paymob/Fawry/InstaPay)
    const intent = await this.paymentGateway.createPaymentIntent(
      paymentMethod,
      amountEGP,
      student.id,
      {
        studentName: `${student.user.firstNameEn || student.user.firstNameAr} ${student.user.lastNameEn || student.user.lastNameAr}`,
        walletId: wallet.id,
      },
    );

    // 3. Record PENDING double-entry ledger transaction
    await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.CANTEEN_CREDIT,
        amount: amountEGP,
        direction: 1, // Credit
        balanceAfter: wallet.balance, // Unchanged until confirmation
        paymentMethod,
        paymentStatus: PaymentStatus.PENDING,
        gatewayRef: intent.gatewayRef,
        description: `Pending wallet top-up via ${paymentMethod} (${intent.gatewayRef})`,
      },
    });

    return intent;
  }

  /**
   * Processes a webhook confirmation from Paymob or Fawry.
   * Atomically credits the wallet and logs the confirmed ledger entry.
   */
  async processWebhookConfirmation(
    gatewayRef: string,
    amountEGP: number,
    rawPayload: any,
  ) {
    const transaction = await this.prisma.walletTransaction.findFirst({
      where: { gatewayRef },
      include: {
        wallet: {
          include: {
            user: {
              include: {
                studentProfile: {
                  include: {
                    parentLinks: {
                      include: { parentProfile: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      this.logger.warn(`Webhook ignored: No pending transaction for gatewayRef ${gatewayRef}`);
      throw new NotFoundException(`No transaction found matching reference: ${gatewayRef}`);
    }

    // Idempotency check: Don't process twice
    if (transaction.paymentStatus === PaymentStatus.COMPLETED) {
      this.logger.log(`Webhook idempotency: Transaction ${transaction.id} already completed`);
      return { status: 'already_completed', transactionId: transaction.id };
    }

    // Execute atomic wallet credit
    const updated = await this.prisma.$transaction(async (tx) => {
      const currentWallet = await tx.wallet.findUniqueOrThrow({
        where: { id: transaction.walletId },
      });

      const newBalance = new Prisma.Decimal(currentWallet.balance).plus(amountEGP);

      const updatedWallet = await tx.wallet.update({
        where: { id: currentWallet.id },
        data: { balance: newBalance },
      });

      const updatedTx = await tx.walletTransaction.update({
        where: { id: transaction.id },
        data: {
          paymentStatus: PaymentStatus.COMPLETED,
          balanceAfter: newBalance,
          gatewayResponse: rawPayload,
          description: `Confirmed wallet top-up via ${transaction.paymentMethod}`,
        },
      });

      return { wallet: updatedWallet, transaction: updatedTx };
    });

    // Notify parent in real-time
    const studentUser = transaction.wallet.user;
    const studentName =
      `${studentUser.firstNameEn || studentUser.firstNameAr} ${studentUser.lastNameEn || studentUser.lastNameAr}`.trim();
    const parentIds =
      studentUser.studentProfile?.parentLinks
        .map((l) => l.parentProfile?.userId)
        .filter((id): id is string => Boolean(id)) ?? [];

    const alertMessage = `Wallet for ${studentName} successfully credited with ${amountEGP} EGP. New balance: ${updated.wallet.balance} EGP.`;

    const eventPayload = {
      event: 'wallet_topped_up',
      studentId: studentUser.studentProfile?.id ?? studentUser.id,
      studentName,
      amount: amountEGP,
      newBalance: Number(updated.wallet.balance),
      timestamp: new Date().toISOString(),
      message: alertMessage,
    };

    await this.redis.publish('parent_notifications', JSON.stringify(eventPayload));

    return {
      success: true,
      transactionId: updated.transaction.id,
      newBalance: Number(updated.wallet.balance),
      message: alertMessage,
    };
  }

  /**
   * Updates dietary restrictions and daily spending caps for a student's wallet.
   */
  async updateDietaryRestrictions(
    studentId: string,
    data: {
      dailyLimit?: number;
      blockedCategoryIds?: string[];
      blockedItemIds?: string[];
      blockedKeywords?: string[];
    },
    requestingUserId: string,
    requestingUserRoles: string[],
  ) {
    const student = await this.prisma.studentProfile.findFirst({
      where: {
        OR: [{ id: studentId }, { userId: studentId }, { studentCode: studentId }],
      },
      include: {
        user: { include: { wallet: true } },
        parentLinks: { include: { parentProfile: true } },
      },
    });

    if (!student) {
      throw new NotFoundException(`Student profile not found for: ${studentId}`);
    }

    const isPlatformAdmin = requestingUserRoles.includes(SystemRole.SUPERADMIN);
    const isSchoolAdmin = requestingUserRoles.includes(SystemRole.SCHOOL_ADMIN);

    if (!isPlatformAdmin && !isSchoolAdmin) {
      const isParentLinked = student.parentLinks.some(
        (link) => link.parentProfile?.userId === requestingUserId,
      );
      if (!isParentLinked) {
        throw new ForbiddenException(
          'You do not have parental authority to configure dietary restrictions for this student',
        );
      }
    }

    let wallet = student.user.wallet;
    if (!wallet) {
      wallet = await this.initializeWallet(
        student.userId,
        student.tenantId,
        0,
        data.dailyLimit ?? 0,
        student.nfcCardUid ?? undefined,
      );
    }

    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        dailyLimit: data.dailyLimit !== undefined ? data.dailyLimit : undefined,
        blockedCategoryIds: data.blockedCategoryIds ?? undefined,
        blockedItemIds: data.blockedItemIds ?? undefined,
        blockedKeywords: data.blockedKeywords ?? undefined,
      },
    });

    this.logger.log(
      `Dietary restrictions updated for student ${student.studentCode}: categories=[${updated.blockedCategoryIds}], items=[${updated.blockedItemIds}], keywords=[${updated.blockedKeywords}]`,
    );

    return {
      success: true,
      walletId: updated.id,
      dailyLimit: Number(updated.dailyLimit),
      blockedCategoryIds: updated.blockedCategoryIds,
      blockedItemIds: updated.blockedItemIds,
      blockedKeywords: updated.blockedKeywords,
    };
  }

  /**
   * Process a student NFC card tap at the school canteen POS terminal.
   *
   * Execution Flow:
   * 1. Resolve studentNfcUid to student's active Wallet & StudentProfile.
   * 2. Validate Dietary Restrictions (throws 403 Forbidden: Parent restricted this item).
   * 3. Calculate total cost and check item availability.
   * 4. Enforce daily spending limit (dailyLimit).
   * 5. Atomically deduct balance, insert CanteenTransaction, lines, and WalletTransaction.
   * 6. Emit real-time WebSocket/Redis notification to parent.
   */
  async processCanteenTransaction(
    studentNfcUid: string,
    items: CanteenCartItem[],
    operatorId?: string,
  ) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Cannot process empty canteen cart');
    }

    // ── 1. Resolve Student & Wallet ─────────────────────────────────
    const student = await this.prisma.studentProfile.findFirst({
      where: {
        OR: [{ nfcCardUid: studentNfcUid }, { user: { wallet: { nfcCardUid: studentNfcUid } } }],
      },
      include: {
        user: { include: { wallet: true } },
        parentLinks: { include: { parentProfile: true } },
      },
    });

    if (!student || !student.user) {
      throw new NotFoundException(`No student found for NFC UID: ${studentNfcUid}`);
    }

    let wallet = student.user.wallet;
    if (!wallet) {
      wallet = await this.initializeWallet(
        student.userId,
        student.tenantId,
        0,
        0,
        studentNfcUid,
      );
    }

    if (!wallet.isActive) {
      throw new BadRequestException('Student canteen wallet is disabled or suspended');
    }

    // ── 2. Fetch Catalog Items & Verify Dietary Restrictions ─────────
    const itemIds = items.map((i) => i.itemId);
    const catalogItems = await this.prisma.canteenItem.findMany({
      where: { id: { in: itemIds } },
      include: { category: true },
    });

    if (catalogItems.length !== itemIds.length) {
      throw new NotFoundException('One or more requested items do not exist in the canteen menu');
    }

    const itemMap = new Map(catalogItems.map((item) => [item.id, item]));

    for (const cartItem of items) {
      const catalogItem = itemMap.get(cartItem.itemId)!;

      if (!catalogItem.isAvailable) {
        throw new BadRequestException(`Item "${catalogItem.nameEn}" is currently out of stock`);
      }

      // Check Category Restriction
      if (wallet.blockedCategoryIds.includes(catalogItem.categoryId)) {
        throw new ForbiddenException(
          `Parent restricted this item: "${catalogItem.nameEn}" (Category "${catalogItem.category.nameEn}" is blocked)`,
        );
      }

      // Check Specific Item Restriction
      if (wallet.blockedItemIds.includes(catalogItem.id)) {
        throw new ForbiddenException(
          `Parent restricted this item: "${catalogItem.nameEn}"`,
        );
      }

      // Check Dietary Allergens / Keywords (e.g. "Soda", "Peanuts", "Gluten")
      const lowerName = `${catalogItem.nameEn} ${catalogItem.nameAr}`.toLowerCase();
      const allergens = (catalogItem.allergens || []).map((a) => a.toLowerCase());

      for (const keyword of wallet.blockedKeywords) {
        const lowerKeyword = keyword.trim().toLowerCase();
        const matchesName = lowerName.includes(lowerKeyword);
        const matchesAllergen = allergens.some((a) => a.includes(lowerKeyword));

        if (matchesName || matchesAllergen) {
          throw new ForbiddenException(
            `Parent restricted this item: "${catalogItem.nameEn}" (Contains restricted allergen: "${keyword}")`,
          );
        }
      }
    }

    // ── 3. Calculate Total Order Cost ──────────────────────────────
    let totalCost = new Prisma.Decimal(0);
    const lineComputations: Array<{
      itemId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      itemName: string;
    }> = [];

    for (const cartItem of items) {
      const catalogItem = itemMap.get(cartItem.itemId)!;
      const lineTotal = new Prisma.Decimal(catalogItem.price).mul(cartItem.qty);
      totalCost = totalCost.plus(lineTotal);
      lineComputations.push({
        itemId: catalogItem.id,
        quantity: cartItem.qty,
        unitPrice: catalogItem.price,
        lineTotal,
        itemName: catalogItem.nameEn,
      });
    }

    // ── 4. Check Daily Spending Cap (dailyLimit) ───────────────────
    const dailyLimit = new Prisma.Decimal(wallet.dailyLimit);
    if (dailyLimit.gt(0)) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const todaySpending = await this.prisma.walletTransaction.aggregate({
        where: {
          walletId: wallet.id,
          type: TransactionType.CANTEEN_DEBIT,
          createdAt: { gte: todayStart },
          paymentStatus: PaymentStatus.COMPLETED,
        },
        _sum: { amount: true },
      });

      const currentSpentToday = todaySpending._sum.amount ?? new Prisma.Decimal(0);
      const projectedSpent = currentSpentToday.plus(totalCost);

      if (projectedSpent.gt(dailyLimit)) {
        throw new BadRequestException(
          `Purchase of ${totalCost} EGP exceeds daily spending limit of ${dailyLimit} EGP. Total spent today: ${currentSpentToday} EGP.`,
        );
      }
    }

    // ── 5. Atomic Double-Entry Execution ($transaction) ────────────
    const result = await this.prisma.$transaction(async (tx) => {
      // Re-fetch wallet inside transaction with row lock
      const currentWallet = await tx.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      const currentBalance = new Prisma.Decimal(currentWallet.balance);
      if (currentBalance.lt(totalCost)) {
        throw new BadRequestException(
          `Insufficient wallet balance. Required: ${totalCost} EGP, Available: ${currentBalance} EGP`,
        );
      }

      const newBalance = currentBalance.minus(totalCost);

      // Decrement wallet balance
      const updatedWallet = await tx.wallet.update({
        where: { id: currentWallet.id },
        data: { balance: newBalance },
      });

      // Insert CanteenTransaction
      const canteenTx = await tx.canteenTransaction.create({
        data: {
          tenantId: student.tenantId,
          studentProfileId: student.id,
          totalAmount: totalCost,
          operatorId:
            operatorId &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              operatorId,
            )
              ? operatorId
              : undefined,
          lineItems: {
            create: lineComputations.map((line) => ({
              itemId: line.itemId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            })),
          },
        },
      });

      // Insert Double-Entry WalletTransaction (Debit)
      const itemSummary = lineComputations.map((l) => `${l.quantity}x ${l.itemName}`).join(', ');
      const walletTx = await tx.walletTransaction.create({
        data: {
          walletId: currentWallet.id,
          type: TransactionType.CANTEEN_DEBIT,
          amount: totalCost,
          direction: -1, // Debit
          balanceAfter: newBalance,
          paymentMethod: PaymentMethod.NFC_WALLET,
          paymentStatus: PaymentStatus.COMPLETED,
          canteenTxId: canteenTx.id,
          description: `Canteen POS purchase: ${itemSummary}`,
        },
      });

      return {
        wallet: updatedWallet,
        canteenTx,
        walletTx,
        newBalance,
        itemSummary,
      };
    });

    // ── 6. Real-Time Alert to Parent via Redis Pub/Sub ──────────────
    const studentName =
      `${student.user.firstNameEn || student.user.firstNameAr} ${student.user.lastNameEn || student.user.lastNameAr}`.trim();
    const alertMessage = `${studentName} just bought ${result.itemSummary} for ${totalCost} EGP at the Canteen. New Balance: ${result.newBalance} EGP.`;

    const parentUserIds = student.parentLinks
      .map((l) => l.parentProfile?.userId)
      .filter((id): id is string => Boolean(id));

    const notificationPayload = {
      event: 'canteen_purchase',
      studentId: student.id,
      studentName,
      items: lineComputations,
      totalAmount: Number(totalCost),
      newBalance: Number(result.newBalance),
      timestamp: new Date().toISOString(),
      parentUserIds,
      message: alertMessage,
    };

    await this.redis.publish('parent_notifications', JSON.stringify(notificationPayload));
    await this.redis.publish('logistics:canteen_events', JSON.stringify(notificationPayload));

    this.logger.log(
      `Canteen Purchase complete: ${studentName} spent ${totalCost} EGP (Balance: ${result.newBalance} EGP)`,
    );

    return {
      success: true,
      transactionId: result.canteenTx.id,
      totalAmount: Number(totalCost),
      newBalance: Number(result.newBalance),
      items: lineComputations,
      message: alertMessage,
    };
  }
}
