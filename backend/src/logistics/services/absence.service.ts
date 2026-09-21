import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { BusTrackingGateway } from '../gateways/bus-tracking.gateway';
import { CreateAbsenceDto, AbsenceRound } from '../dto/absence.dto';
import { BoardingStatus, SystemRole } from '@prisma/client';

@Injectable()
export class AbsenceService {
  private readonly logger = new Logger(AbsenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly busTrackingGateway: BusTrackingGateway,
  ) {}

  /**
   * Process parent absence report for student bus route.
   *
   * Execution Flow:
   * 1. Verify parent authority or administrative permissions.
   * 2. Find active BusRouteAssignment for the student.
   * 3. Set Redis key for real-time driver app skip list (`bus:{routeId}:absences:{date}`).
   * 4. Record BoardingLog in Postgres with status ABSENT / PARENT_PICKUP.
   * 5. Fire real-time notification to driver app route room to dynamically skip stop.
   */
  async recordAbsence(
    dto: CreateAbsenceDto,
    requestingUserId: string,
    requestingUserRoles: string[],
  ) {
    const { studentId, reason, round = AbsenceRound.FULL_DAY } = dto;
    const dateStr = dto.date ?? new Date().toISOString().slice(0, 10);

    // ── 1. Find Student & Parental Authorization ───────────────────
    const student = await this.prisma.studentProfile.findFirst({
      where: {
        OR: [{ id: studentId }, { userId: studentId }, { studentCode: studentId }],
      },
      include: {
        user: true,
        transportAssignment: {
          include: {
            route: true,
            stop: true,
          },
        },
        parentLinks: {
          include: {
            parentProfile: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException(`Student profile not found for identifier: ${studentId}`);
    }

    const isPlatformAdmin = requestingUserRoles.includes(SystemRole.SUPERADMIN);
    const isSchoolAdmin = requestingUserRoles.includes(SystemRole.SCHOOL_ADMIN);

    if (!isPlatformAdmin && !isSchoolAdmin) {
      const isParentLinked = student.parentLinks.some(
        (link) => link.parentProfile?.userId === requestingUserId,
      );

      if (!isParentLinked) {
        throw new ForbiddenException(
          'You are not registered as an authorized parent or guardian for this student',
        );
      }
    }

    // ── 2. Check Bus Route Assignment ──────────────────────────────
    const assignment = student.transportAssignment;
    if (!assignment) {
      throw new BadRequestException(
        `Student ${student.studentCode} is not registered for any active bus route`,
      );
    }

    const route = assignment.route;
    const studentName =
      `${student.user.firstNameEn || student.user.firstNameAr} ${student.user.lastNameEn || student.user.lastNameAr}`.trim();

    // ── 3. Store Absence in Redis for Driver Navigation ─────────────
    // Key: bus:{routeId}:absences:{date} (Redis Set)
    const redisClient = this.redis.getClient();
    const absenceSetKey = `bus:${route.id}:absences:${dateStr}`;
    const absenceMetaKey = `bus:${route.id}:absence_meta:${student.id}:${dateStr}`;

    await redisClient
      .pipeline()
      .sadd(absenceSetKey, student.id)
      .expire(absenceSetKey, 86_400) // 24-hour TTL
      .set(
        absenceMetaKey,
        JSON.stringify({
          studentId: student.id,
          studentName,
          stopId: assignment.stopId,
          stopName: assignment.stop.nameAr,
          round,
          reason,
          reportedAt: new Date().toISOString(),
        }),
        'EX',
        86_400,
      )
      .exec();

    // ── 4. Record in PostgreSQL (BoardingLog) ────────────────────────
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const existingAbsenceLog = await this.prisma.boardingLog.findFirst({
      where: {
        routeId: route.id,
        studentId: student.userId,
        scannedAt: { gte: todayStart },
        status: { in: [BoardingStatus.ABSENT, BoardingStatus.PARENT_PICKUP] },
      },
    });

    let logId = existingAbsenceLog?.id;
    if (!existingAbsenceLog) {
      const newLog = await this.prisma.boardingLog.create({
        data: {
          routeId: route.id,
          studentId: student.userId,
          scannedById: requestingUserId,
          status: BoardingStatus.ABSENT,
          scannedAt: now,
        },
      });
      logId = newLog.id;
    }

    // ── 5. Real-Time Alert to Driver App (Route Room) ───────────────
    const alertMessage = `Stop skipped: Student ${studentName} reported absent on ${dateStr} (${round}).`;

    await this.busTrackingGateway.broadcastAbsenceEvent({
      routeId: route.id,
      studentId: student.userId,
      studentName,
      stopId: assignment.stopId,
      date: dateStr,
      round,
      reason,
      message: alertMessage,
    });

    this.logger.log(
      `Absence recorded: ${studentName} on Route "${route.name}" for ${dateStr} (${round})`,
    );

    return {
      success: true,
      logId,
      student: {
        id: student.id,
        code: student.studentCode,
        name: studentName,
      },
      route: {
        id: route.id,
        name: route.name,
      },
      stop: {
        id: assignment.stop.id,
        name: assignment.stop.nameAr,
      },
      date: dateStr,
      round,
      reason: reason || 'Not specified',
      message: 'Student absence registered. Driver navigation updated to skip stop.',
    };
  }
}
