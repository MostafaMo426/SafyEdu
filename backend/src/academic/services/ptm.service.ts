import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PTMStatus } from '@prisma/client';
import {
  BookPtmSlotDto,
  CreatePtmCycleDto,
  CreatePtmSlotDto,
} from '../dto/ptm.dto';

function formatUserName(user?: {
  firstNameEn?: string | null;
  lastNameEn?: string | null;
  firstNameAr?: string | null;
  lastNameAr?: string | null;
} | null): string {
  if (!user) return 'Unknown';
  if (user.firstNameEn && user.lastNameEn) {
    return `${user.firstNameEn} ${user.lastNameEn}`;
  }
  return `${user.firstNameAr ?? ''} ${user.lastNameAr ?? ''}`.trim() || 'Unknown';
}

@Injectable()
export class PtmService {
  private readonly logger = new Logger(PtmService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Books a 10-minute PTM slot.
   * Concurrency-safe:
   * 1. Validates parent-child link.
   * 2. Validates student has active classroom enrollment.
   * 3. Validates teacher actually teaches this student (homeroom or timetable slot).
   * 4. Exclusively locks slot using an atomic PostgreSQL transaction (rejects double booking with 409 Conflict).
   */
  async bookSlot(dto: BookPtmSlotDto, requestingUserId?: string) {
    const parentId = requestingUserId || dto.parentId;
    if (!parentId) {
      throw new BadRequestException('Parent ID is required to book a conference slot');
    }

    // 1. Verify Parent <-> Student Link
    const parentStudentLink = await this.prisma.parentStudentLink.findFirst({
      where: {
        parentProfile: { userId: parentId },
        studentProfile: { userId: dto.studentId },
      },
    });

    if (!parentStudentLink) {
      throw new ForbiddenException(
        `User ${parentId} is not registered as a parent or guardian of student ${dto.studentId}`,
      );
    }

    // 2. Fetch PTM Slot with Cycle and Teacher
    const slot = await this.prisma.pTMSlot.findUnique({
      where: { id: dto.slotId },
      include: {
        cycle: true,
        teacher: true,
      },
    });

    if (!slot) {
      throw new NotFoundException(`PTM Slot with ID ${dto.slotId} not found`);
    }

    if (!slot.cycle.isOpen) {
      throw new BadRequestException(
        `PTM Cycle "${slot.cycle.title}" is currently closed for bookings`,
      );
    }

    if (slot.status !== PTMStatus.AVAILABLE) {
      throw new ConflictException('Slot already booked or unavailable');
    }

    // 3. Verify Teacher Teaches the Child
    // Find active classroom enrollment for student
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentProfile: { userId: dto.studentId },
        withdrawnAt: null,
      },
      include: {
        classroom: true,
      },
    });

    if (!enrollment) {
      throw new BadRequestException(
        `Student ${dto.studentId} has no active classroom enrollment`,
      );
    }

    const isHometeacher = enrollment.classroom.hometeacherId === slot.teacherId;
    const timetableSlot = await this.prisma.timetableSlot.findFirst({
      where: {
        classroomId: enrollment.classroomId,
        teacherProfile: { userId: slot.teacherId },
      },
    });

    const teacherName = formatUserName(slot.teacher);
    const teachesChild = isHometeacher || !!timetableSlot;
    if (!teachesChild) {
      throw new ForbiddenException(
        `Teacher ${teacherName} does not teach student in classroom ${enrollment.classroom.section}`,
      );
    }

    // 4. Concurrency-Safe Booking via Atomic PostgreSQL Transaction
    return await this.prisma.$transaction(async (tx) => {
      // Step A: Atomically transition slot from AVAILABLE to BOOKED
      const updateResult = await tx.pTMSlot.updateMany({
        where: {
          id: dto.slotId,
          status: PTMStatus.AVAILABLE,
        },
        data: {
          status: PTMStatus.BOOKED,
        },
      });

      if (updateResult.count === 0) {
        // Another concurrent transaction already acquired this slot
        throw new ConflictException('Slot already booked or unavailable');
      }

      // Step B: Insert PTMBooking record
      try {
        const booking = await tx.pTMBooking.create({
          data: {
            slotId: dto.slotId,
            parentId,
            studentId: dto.studentId,
            notes: dto.notes,
            status: PTMStatus.BOOKED,
          },
          include: {
            slot: {
              include: {
                teacher: {
                  select: {
                    id: true,
                    firstNameAr: true,
                    lastNameAr: true,
                    firstNameEn: true,
                    lastNameEn: true,
                    email: true,
                  },
                },
                cycle: true,
              },
            },
            parent: {
              select: {
                id: true,
                firstNameAr: true,
                lastNameAr: true,
                firstNameEn: true,
                lastNameEn: true,
                email: true,
              },
            },
          },
        });

        this.logger.log(
          `PTM Slot ${dto.slotId} booked successfully by Parent ${parentId} for Student ${dto.studentId} with Teacher ${teacherName}`,
        );

        return booking;
      } catch (err: any) {
        if (err.code === 'P2002') {
          // Unique constraint on slotId
          throw new ConflictException('Slot already booked or unavailable');
        }
        throw err;
      }
    });
  }

  /**
   * Retrieves all slots for a PTM cycle.
   */
  async getCycleSlots(cycleId: string, teacherId?: string) {
    return this.prisma.pTMSlot.findMany({
      where: {
        cycleId,
        ...(teacherId ? { teacherId } : {}),
      },
      include: {
        teacher: {
          select: {
            id: true,
            firstNameAr: true,
            lastNameAr: true,
            firstNameEn: true,
            lastNameEn: true,
            email: true,
          },
        },
        booking: {
          select: {
            id: true,
            parentId: true,
            studentId: true,
            status: true,
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  /**
   * Retrieves active PTM cycles.
   */
  async getActiveCycles(termId?: string) {
    return this.prisma.pTMCycle.findMany({
      where: {
        isOpen: true,
        ...(termId ? { termId } : {}),
      },
      include: {
        term: true,
      },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * Helper to create a PTM cycle.
   */
  async createCycle(dto: CreatePtmCycleDto) {
    return this.prisma.pTMCycle.create({
      data: {
        termId: dto.termId,
        title: dto.title,
        date: new Date(dto.date),
        mode: dto.mode,
        venueInfo: dto.venueInfo,
        isOpen: dto.isOpen ?? true,
      },
    });
  }

  /**
   * Helper to create a 10-minute PTM slot.
   */
  async createSlot(dto: CreatePtmSlotDto) {
    return this.prisma.pTMSlot.create({
      data: {
        cycleId: dto.cycleId,
        teacherId: dto.teacherId,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        meetingUrl: dto.meetingUrl,
        status: PTMStatus.AVAILABLE,
      },
    });
  }
}
