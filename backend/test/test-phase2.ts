import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { BoardingService } from '../src/logistics/services/boarding.service';
import { AbsenceService } from '../src/logistics/services/absence.service';
import { FleetService } from '../src/logistics/services/fleet.service';
import { BoardingStatus, SystemRole, UserStatus } from '@prisma/client';
import * as assert from 'assert';

async function runPhase2Tests() {
  console.log('🧪 Starting Phase 2.2 & 2.3 Automated Verification...\n');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: ['error', 'warn'] },
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const boardingService = app.get(BoardingService);
  const absenceService = app.get(AbsenceService);
  const fleetService = app.get(FleetService);

  const testSuffix = Date.now().toString().slice(-6);

  try {
    // ── 0. Seed Test Fixtures ───────────────────────────────────────
    console.log('1. Setting up test fixtures (Tenant, Users, BusRoute, Student, Parent)...');

    const tenant = await prisma.tenant.create({
      data: {
        nameAr: `أكاديمية الاختبار ${testSuffix}`,
        nameEn: `Test Academy ${testSuffix}`,
        slug: `test-academy-${testSuffix}`,
      },
    });

    const matronUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `matron${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'فاطمة',
        lastNameAr: 'علي',
        status: UserStatus.ACTIVE,
      },
    });

    const studentUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `student${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'يوسف',
        lastNameAr: 'محمد',
        firstNameEn: 'Youssef',
        lastNameEn: 'Mohamed',
        status: UserStatus.ACTIVE,
      },
    });

    const nfcUid = `NFC-TEST-${testSuffix}`;
    const studentProfile = await prisma.studentProfile.create({
      data: {
        userId: studentUser.id,
        tenantId: tenant.id,
        studentCode: `STU-${testSuffix}`,
        nfcCardUid: nfcUid,
      },
    });

    const parentUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `parent${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'محمد',
        lastNameAr: 'أحمد',
        status: UserStatus.ACTIVE,
      },
    });

    const parentProfile = await prisma.parentProfile.create({
      data: {
        userId: parentUser.id,
        tenantId: tenant.id,
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

    const busRoute = await prisma.busRoute.create({
      data: {
        tenantId: tenant.id,
        name: `Route 101 - Tagamoa ${testSuffix}`,
        vehiclePlate: `ABC-${testSuffix.slice(0, 3)}`,
        capacity: 35,
        driverName: 'Captain Tarek',
        driverPhone: '+201000000001',
      },
    });

    const busStop = await prisma.busStop.create({
      data: {
        routeId: busRoute.id,
        nameAr: 'محطة شارع التسعين',
        nameEn: '90th Street Station',
        latitude: 30.0270,
        longitude: 31.4280,
        stopOrder: 1,
      },
    });

    await prisma.busRouteAssignment.create({
      data: {
        studentProfileId: studentProfile.id,
        routeId: busRoute.id,
        stopId: busStop.id,
      },
    });

    console.log('   ✅ Test fixtures initialized successfully.\n');

    // ── TEST 1: NFC Tap-In (Boarding) ──────────────────────────────
    console.log('2. Testing NFC Tap-In (Student Boarding)...');
    const tapInResult = await boardingService.processTap(
      {
        studentNfcUid: nfcUid,
        busId: busRoute.id,
        lat: 30.0271,
        lng: 31.4281,
      },
      matronUser.id,
    );

    assert.strictEqual(tapInResult.success, true);
    assert.strictEqual(tapInResult.status, BoardingStatus.BOARDED);
    assert.strictEqual(tapInResult.student.code, `STU-${testSuffix}`);
    console.log(`   ✅ Tap-In successful: "${tapInResult.message}"\n`);

    // ── TEST 2: NFC Tap-Out (Alighting) ────────────────────────────
    console.log('3. Testing consecutive NFC Tap (Auto-toggle to Alighting)...');
    const tapOutResult = await boardingService.processTap(
      {
        studentNfcUid: nfcUid,
        busId: busRoute.id,
        lat: 30.0300,
        lng: 31.4300,
      },
      matronUser.id,
    );

    assert.strictEqual(tapOutResult.success, true);
    assert.strictEqual(tapOutResult.status, BoardingStatus.ALIGHTED);
    console.log(`   ✅ Tap-Out auto-toggle successful: "${tapOutResult.message}"\n`);

    // ── TEST 3: Validation (Wrong Bus Assignment) ──────────────────
    console.log('4. Testing validation: Tap on unassigned bus...');
    const fakeBusId = '00000000-0000-0000-0000-000000000999';
    let caughtWrongBus = false;
    try {
      await boardingService.processTap(
        {
          studentNfcUid: nfcUid,
          busId: fakeBusId,
          lat: 30.0,
          lng: 31.0,
        },
        matronUser.id,
      );
    } catch (err: any) {
      caughtWrongBus = true;
      console.log(`   ✅ Expected error caught: "${err.message}"\n`);
    }
    assert.strictEqual(caughtWrongBus, true);

    // ── TEST 4: Parent Absence Toggle ──────────────────────────────
    console.log('5. Testing Parent Absence Toggle (POST /absence)...');
    const todayStr = new Date().toISOString().slice(0, 10);
    const absenceResult = await absenceService.recordAbsence(
      {
        studentId: studentProfile.id,
        date: todayStr,
        reason: 'Flu symptoms',
      },
      parentUser.id,
      [SystemRole.PARENT],
    );

    assert.strictEqual(absenceResult.success, true);

    // Verify Redis Set contains student ID
    const isMember = await redis
      .getClient()
      .sismember(`bus:${busRoute.id}:absences:${todayStr}`, studentProfile.id);
    assert.strictEqual(isMember, 1);
    console.log('   ✅ Redis dynamic skip set verified for driver navigation.\n');

    // ── TEST 5: Fleet Control Room API (GET /active-fleet) ─────────
    console.log('6. Testing Fleet Control Room API (Redis MGET + Postgres Count)...');

    // Mock live GPS coordinate into Redis
    const mockTelemetry = {
      busId: busRoute.id,
      routeId: busRoute.id,
      latitude: 30.0285,
      longitude: 31.4312,
      speed: 38.5,
      heading: 90,
      timestamp: new Date().toISOString(),
    };
    await redis.setex(
      `bus:${busRoute.id}:location`,
      120,
      JSON.stringify(mockTelemetry),
    );

    const activeFleet = await fleetService.getActiveFleet(tenant.id);
    assert(activeFleet.length >= 1);
    const ourBus = activeFleet.find((b) => b.busId === busRoute.id);
    assert(ourBus);
    assert.strictEqual(ourBus.isOnline, true);
    assert.strictEqual(ourBus.location?.latitude, 30.0285);
    assert.strictEqual(ourBus.vehiclePlate, `ABC-${testSuffix.slice(0, 3)}`);
    console.log('   ✅ Active fleet endpoint verified with live GPS & passenger counts:');
    console.log(JSON.stringify(ourBus, null, 2));

    console.log('\n🎉 ALL PHASE 2.2 & 2.3 AUTOMATED TESTS PASSED SUCCESSFULLY!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

runPhase2Tests();
