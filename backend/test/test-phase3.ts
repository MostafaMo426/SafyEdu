import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { WalletService } from '../src/finance/services/wallet.service';
import { PaymentMethod, PaymentStatus, SystemRole, TransactionType, UserStatus } from '@prisma/client';
import * as assert from 'assert';

async function runPhase3Tests() {
  console.log('🧪 Starting Phase 3.1 & 3.2 Automated Verification...\n');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: ['error', 'warn'] },
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const walletService = app.get(WalletService);

  const testSuffix = Date.now().toString().slice(-6);

  try {
    // ── 0. Seed Test Fixtures ───────────────────────────────────────
    console.log('1. Setting up test fixtures (Tenant, Users, Student, Wallet, Canteen Items)...');

    const tenant = await prisma.tenant.create({
      data: {
        nameAr: `أكاديمية فينانس ${testSuffix}`,
        nameEn: `Finance Academy ${testSuffix}`,
        slug: `finance-academy-${testSuffix}`,
      },
    });

    const parentUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `finparent${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'عمرو',
        lastNameAr: 'دياب',
        status: UserStatus.ACTIVE,
      },
    });

    const parentProfile = await prisma.parentProfile.create({
      data: {
        userId: parentUser.id,
        tenantId: tenant.id,
      },
    });

    const studentUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `finstudent${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'عمر',
        lastNameAr: 'دياب',
        firstNameEn: 'Omar',
        lastNameEn: 'Diab',
        status: UserStatus.ACTIVE,
      },
    });

    const nfcCardUid = `NFC-WALLET-${testSuffix}`;
    const studentProfile = await prisma.studentProfile.create({
      data: {
        userId: studentUser.id,
        tenantId: tenant.id,
        studentCode: `FIN-${testSuffix}`,
        nfcCardUid: nfcCardUid,
      },
    });

    await prisma.parentStudentLink.create({
      data: {
        parentProfileId: parentProfile.id,
        studentProfileId: studentProfile.id,
        relationship: 'Father',
        isPrimary: true,
      },
    });

    // Initialize student wallet with 0 balance
    const wallet = await walletService.initializeWallet(
      studentUser.id,
      tenant.id,
      0,
      100, // 100 EGP daily limit
      nfcCardUid,
    );

    // Seed Canteen Categories and Items
    const healthyCategory = await prisma.canteenCategory.create({
      data: {
        tenantId: tenant.id,
        nameAr: 'شطائر وسلطات',
        nameEn: 'Sandwiches & Salads',
      },
    });

    const sodaCategory = await prisma.canteenCategory.create({
      data: {
        tenantId: tenant.id,
        nameAr: 'مشروبات غازية',
        nameEn: 'Sodas & Energy Drinks',
      },
    });

    // Item 1: Healthy Turkey Sandwich (40 EGP)
    const turkeySandwich = await prisma.canteenItem.create({
      data: {
        tenantId: tenant.id,
        categoryId: healthyCategory.id,
        nameAr: 'ساندوتش ديك رومي',
        nameEn: 'Smoked Turkey Sandwich',
        price: 40.0,
        allergens: ['Dairy', 'Gluten'],
      },
    });

    // Item 2: Fresh Orange Juice (25 EGP)
    const orangeJuice = await prisma.canteenItem.create({
      data: {
        tenantId: tenant.id,
        categoryId: healthyCategory.id,
        nameAr: 'عصير برتقال طازج',
        nameEn: 'Fresh Orange Juice',
        price: 25.0,
        allergens: [],
      },
    });

    // Item 3: Peanut Butter Protein Bar (Contains Peanuts allergen) (30 EGP)
    const peanutBar = await prisma.canteenItem.create({
      data: {
        tenantId: tenant.id,
        categoryId: healthyCategory.id,
        nameAr: 'لوح بروتين بالفول السوداني',
        nameEn: 'Peanut Butter Protein Bar',
        price: 30.0,
        allergens: ['Peanuts', 'Soy'],
      },
    });

    // Item 4: Cola Soda Can (15 EGP)
    const colaSoda = await prisma.canteenItem.create({
      data: {
        tenantId: tenant.id,
        categoryId: sodaCategory.id,
        nameAr: 'كان كولا',
        nameEn: 'Cola Soda 330ml',
        price: 15.0,
        allergens: [],
      },
    });

    console.log('   ✅ Test fixtures and canteen catalog created.\n');

    // ── TEST 1: Initiate Top-Up & Simulate Paymob Webhook ────────────
    console.log('2. Testing Parent Top-Up via Egyptian Gateway Simulation (Paymob / Fawry)...');
    const topUpAmount = 500; // 500 EGP
    const intent = await walletService.initiateTopUp(
      studentProfile.id,
      topUpAmount,
      PaymentMethod.PAYMOB_CARD,
      parentUser.id,
    );

    assert(intent.orderId);
    assert(intent.paymentLink?.includes('paymob.com'));
    console.log(`   ✅ Top-Up initiated: ${intent.orderId} (Payment link generated)`);

    // Simulate Paymob Webhook callback confirming payment
    console.log('   Simulating Paymob webhook callback...');
    const webhookResult = await walletService.processWebhookConfirmation(
      intent.gatewayRef,
      topUpAmount,
      {
        orderId: intent.orderId,
        transactionId: 'txn_mock_987654',
        success: true,
        amountCents: topUpAmount * 100,
      },
    );

    assert.strictEqual(webhookResult.success, true);
    assert.strictEqual(webhookResult.newBalance, 500);

    // Verify PostgreSQL double-entry transaction record
    const creditTx = await prisma.walletTransaction.findFirst({
      where: { gatewayRef: intent.gatewayRef },
    });
    assert(creditTx);
    assert.strictEqual(creditTx.paymentStatus, PaymentStatus.COMPLETED);
    assert.strictEqual(creditTx.direction, 1);
    assert.strictEqual(Number(creditTx.amount), 500);
    console.log(`   ✅ Webhook processed. Wallet balance: ${webhookResult.newBalance} EGP.\n`);

    // ── TEST 2: Student Valid NFC Canteen Purchase ───────────────────
    console.log('3. Testing Student NFC Canteen Purchase (Sandwich + Orange Juice = 65 EGP)...');
    const purchaseResult = await walletService.processCanteenTransaction(
      nfcCardUid,
      [
        { itemId: turkeySandwich.id, qty: 1 }, // 40 EGP
        { itemId: orangeJuice.id, qty: 1 },    // 25 EGP
      ],
      parentUser.id,
    );

    assert.strictEqual(purchaseResult.success, true);
    assert.strictEqual(purchaseResult.totalAmount, 65);
    assert.strictEqual(purchaseResult.newBalance, 435); // 500 - 65 = 435

    // Verify double-entry ledger line in Postgres
    const debitTx = await prisma.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        type: TransactionType.CANTEEN_DEBIT,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(debitTx);
    assert.strictEqual(debitTx.direction, -1);
    assert.strictEqual(Number(debitTx.amount), 65);
    assert.strictEqual(Number(debitTx.balanceAfter), 435);
    console.log(`   ✅ Purchase successful. New Balance: ${purchaseResult.newBalance} EGP.`);
    console.log(`   ✅ Parent Alert: "${purchaseResult.message}"\n`);

    // ── TEST 3: Dietary Restriction 1 (Blocked Category: Sodas) ──────
    console.log('4. Testing Dietary Restriction: Parent blocks Category "Sodas"...');
    await walletService.updateDietaryRestrictions(
      studentProfile.id,
      {
        dailyLimit: 100,
        blockedCategoryIds: [sodaCategory.id],
      },
      parentUser.id,
      [SystemRole.PARENT],
    );

    let caughtCategoryBlock = false;
    try {
      await walletService.processCanteenTransaction(nfcCardUid, [
        { itemId: colaSoda.id, qty: 1 },
      ]);
    } catch (err: any) {
      caughtCategoryBlock = true;
      console.log(`   ✅ Expected error caught (Category Block): "${err.message}"`);
    }
    assert.strictEqual(caughtCategoryBlock, true);

    // Verify transaction rolled back: Balance must still be 435 EGP
    const walletAfterCategoryCheck = await walletService.getWallet(studentUser.id);
    assert.strictEqual(Number(walletAfterCategoryCheck.balance), 435);
    console.log('   ✅ Transaction rolled back: No balance deducted.\n');

    // ── TEST 4: Dietary Restriction 2 (Allergen Keyword: "Peanuts") ─
    console.log('5. Testing Dietary Restriction: Parent blocks Allergen Keyword "Peanuts"...');
    await walletService.updateDietaryRestrictions(
      studentProfile.id,
      {
        dailyLimit: 100,
        blockedCategoryIds: [sodaCategory.id],
        blockedKeywords: ['Peanuts'],
      },
      parentUser.id,
      [SystemRole.PARENT],
    );

    let caughtAllergenBlock = false;
    try {
      await walletService.processCanteenTransaction(nfcCardUid, [
        { itemId: peanutBar.id, qty: 1 },
      ]);
    } catch (err: any) {
      caughtAllergenBlock = true;
      console.log(`   ✅ Expected error caught (Allergen Block): "${err.message}"`);
    }
    assert.strictEqual(caughtAllergenBlock, true);

    // Verify balance remains 435 EGP
    const walletAfterAllergenCheck = await walletService.getWallet(studentUser.id);
    assert.strictEqual(Number(walletAfterAllergenCheck.balance), 435);
    console.log('   ✅ Transaction rolled back: Balance unchanged.\n');

    // ── TEST 5: Daily Limit Cap Enforcement ─────────────────────────
    console.log('6. Testing Daily Spending Cap (Daily limit 100 EGP, already spent 65 EGP)...');
    // Student already spent 65 EGP today. Buying 2 turkey sandwiches (80 EGP) = 145 EGP > 100 EGP limit
    let caughtDailyLimitExceeded = false;
    try {
      await walletService.processCanteenTransaction(nfcCardUid, [
        { itemId: turkeySandwich.id, qty: 2 }, // 80 EGP
      ]);
    } catch (err: any) {
      caughtDailyLimitExceeded = true;
      console.log(`   ✅ Expected error caught (Daily Limit Exceeded): "${err.message}"`);
    }
    assert.strictEqual(caughtDailyLimitExceeded, true);

    console.log('\n🎉 ALL PHASE 3.1 & 3.2 AUTOMATED TESTS PASSED WITH 100% SUCCESS!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

runPhase3Tests();
