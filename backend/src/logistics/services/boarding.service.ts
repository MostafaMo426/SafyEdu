import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusTrackingGateway } from '../gateways/bus-tracking.gateway';
import { BoardDto, BoardingDirection } from '../dto/board.dto';
import { BoardingStatus } from '@prisma/client';

@Injectable()
export class BoardingService {
  private readonly logger = new Logger(BoardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly busTrackingGateway: BusTrackingGateway,
  ) {}

  /**
   * Process an NFC card tap from the Matron mobile app.
   *
   * Execution Flow:
   * 1. Query Postgres to verify studentNfcUid belongs to an active StudentProfile.
   * 2. Check BusRouteAssignment to verify the child belongs on this specific bus.
   * 3. Insert a BoardingLog record in Postgres (determine direction: PICKUP_TO_SCHOOL or DROPOFF_TO_HOME).
   * 4. Fire real-time event via Redis Pub/Sub to immediately notify the parent's WebSocket room.
   */
  async processTap(dto: BoardDto, scannedByUserId: string) {
    const { studentNfcUid, busId, lat, lng } = dto;

    // ── 1. Verify Student Profile ──────────────────────────────────
    const student = await this.prisma.studentProfile.findUnique({
      where: { nfcCardUid: studentNfcUid },
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
            parentProfile: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!student) {
      this.logger.warn(`NFC Tap rejected: Unknown card UID ${studentNfcUid}`);
      throw new NotFoundException(
        `No student profile registered with NFC Card UID: ${studentNfcUid}`,
      );
    }

    if (student.user.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Student ${student.studentCode} is currently inactive or suspended`,
      );
    }

    // ── 2. Check Bus Route Assignment ──────────────────────────────
    const assignment = student.transportAssignment;
    if (!assignment) {
      throw new BadRequestException(
        `Student ${student.studentCode} does not have an active bus route assignment`,
      );
    }

    // Match by Route UUID or Vehicle Plate
    const isAssignedToThisBus =
      assignment.routeId === busId ||
      assignment.route.vehiclePlate.trim().toLowerCase() ===
        busId.trim().toLowerCase();

    if (!isAssignedToThisBus) {
      throw new BadRequestException(
        `Student ${student.studentCode} is assigned to route "${assignment.route.name}" (${assignment.route.vehiclePlate}), not bus "${busId}"`,
      );
    }

    const route = assignment.route;
    const now = new Date();

    // ── 3. Determine Boarding Status & Direction ───────────────────
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Find the latest tap for this student today
    const lastTapToday = await this.prisma.boardingLog.findFirst({
      where: {
        studentId: student.userId,
        scannedAt: { gte: todayStart },
      },
      orderBy: { scannedAt: 'desc' },
    });

    // Auto-toggle status if not explicitly supplied
    let resolvedStatus: BoardingStatus = dto.status ?? BoardingStatus.BOARDED;
    if (!dto.status) {
      if (lastTapToday && lastTapToday.status === BoardingStatus.BOARDED) {
        resolvedStatus = BoardingStatus.ALIGHTED;
      } else {
        resolvedStatus = BoardingStatus.BOARDED;
      }
    }

    // Determine direction: Morning (< 12:00) vs Afternoon (>= 12:00)
    let direction: BoardingDirection =
      dto.direction ??
      (now.getHours() < 12
        ? BoardingDirection.PICKUP_TO_SCHOOL
        : BoardingDirection.DROPOFF_TO_HOME);

    // ── 4. Persist BoardingLog in Postgres ─────────────────────────
    const boardingLog = await this.prisma.boardingLog.create({
      data: {
        routeId: route.id,
        studentId: student.userId,
        scannedById: scannedByUserId,
        status: resolvedStatus,
        latitude: lat,
        longitude: lng,
        scannedAt: now,
      },
    });

    // ── 5. Real-Time Parent Notification via Redis Pub/Sub ─────────
    const studentName =
      `${student.user.firstNameEn || student.user.firstNameAr} ${student.user.lastNameEn || student.user.lastNameAr}`.trim();
    const formattedTime = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const actionText =
      resolvedStatus === BoardingStatus.BOARDED
        ? 'boarded'
        : resolvedStatus === BoardingStatus.ALIGHTED
          ? 'safely alighted from'
          : 'checked in on';

    const notificationMessage = `Student ${studentName} ${actionText} Bus ${route.name} at ${formattedTime}`;

    const parentUserIds = student.parentLinks
      .map((link) => link.parentProfile?.userId)
      .filter((id): id is string => Boolean(id));

    await this.busTrackingGateway.broadcastBoardingEvent({
      routeId: route.id,
      studentId: student.userId,
      studentName,
      busId: route.id,
      vehiclePlate: route.vehiclePlate,
      status: resolvedStatus,
      direction,
      timestamp: now.toISOString(),
      location: { lat, lng },
      parentUserIds,
      message: notificationMessage,
    });

    this.logger.log(
      `NFC Tap recorded: ${studentName} (${student.studentCode}) → ${resolvedStatus} on ${route.name}`,
    );

    return {
      success: true,
      logId: boardingLog.id,
      student: {
        id: student.id,
        userId: student.userId,
        code: student.studentCode,
        name: studentName,
      },
      route: {
        id: route.id,
        name: route.name,
        plate: route.vehiclePlate,
      },
      stop: {
        id: assignment.stop.id,
        nameAr: assignment.stop.nameAr,
        nameEn: assignment.stop.nameEn,
      },
      status: resolvedStatus,
      direction,
      timestamp: now.toISOString(),
      message: notificationMessage,
    };
  }
}
