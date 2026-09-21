import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { SubstitutionStatus } from '@prisma/client';
import {
  TeacherAbsenceRequestDto,
  TeacherAbsenceResponse,
  SubstitutionAssignmentResult,
} from '../dto/substitution.dto';

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
export class SubstitutionService {
  private readonly logger = new Logger(SubstitutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Al-Ihtiyat (الاحتياط) Automated Teacher Substitution Engine:
   * 1. Retrieves the absent teacher's TimetableSlots for the requested date.
   * 2. Finds substitute teachers who:
   *    - Belong to the same department
   *    - Possess qualifications for the specific subject
   *    - Have isSubstitutable = true
   *    - Have a verified free period (TeacherAvailability & no timetable/substitution conflict)
   * 3. Inserts or updates TeacherSubstitution records (marked AUTO_ASSIGNED).
   * 4. Dispatches real-time push notifications to the substitute teacher's mobile channel via Redis.
   */
  async handleTeacherAbsence(
    dto: TeacherAbsenceRequestDto,
  ): Promise<TeacherAbsenceResponse> {
    // 1. Resolve date and Egyptian day of week (0=Sunday ... 4=Thursday)
    const targetDate = new Date(`${dto.date}T00:00:00Z`);
    if (isNaN(targetDate.getTime())) {
      throw new BadRequestException(`Invalid date format: ${dto.date}`);
    }
    const dayOfWeek = targetDate.getUTCDay();

    // 2. Fetch Absent Teacher Profile
    const absentTeacherProfile = await this.prisma.teacherProfile.findUnique({
      where: { userId: dto.absentTeacherId },
      include: { user: true },
    });

    if (!absentTeacherProfile) {
      throw new NotFoundException(
        `Teacher profile for user ID ${dto.absentTeacherId} not found`,
      );
    }

    const absentTeacherName = formatUserName(absentTeacherProfile.user);
    this.logger.log(
      `Processing teacher absence for ${absentTeacherName} (${dto.absentTeacherId}) on ${dto.date} (Day of Week: ${dayOfWeek})`,
    );

    // 3. Query all timetable slots for the absent teacher on this day of week
    const slots = await this.prisma.timetableSlot.findMany({
      where: {
        teacherProfileId: absentTeacherProfile.id,
        dayOfWeek,
      },
      include: {
        classroom: true,
        subject: true,
        department: true,
      },
      orderBy: { periodNumber: 'asc' },
    });

    if (slots.length === 0) {
      return {
        absentTeacherId: dto.absentTeacherId,
        absentTeacherName,
        date: dto.date,
        dayOfWeek,
        totalSlots: 0,
        coveredSlots: 0,
        uncoveredSlots: 0,
        assignments: [],
      };
    }

    const assignments: SubstitutionAssignmentResult[] = [];
    let coveredSlots = 0;
    let uncoveredSlots = 0;

    // 4. Resolve candidate substitute teachers for each slot
    for (const slot of slots) {
      const candidate = await this.findBestSubstitute(
        slot.departmentId,
        slot.subjectId,
        slot.subject.nameEn,
        absentTeacherProfile.id,
        absentTeacherProfile.tenantId,
        dayOfWeek,
        slot.periodNumber,
        targetDate,
      );

      if (candidate) {
        // Create or update TeacherSubstitution record
        const substitution = await this.prisma.teacherSubstitution.upsert({
          where: {
            timetableSlotId_date: {
              timetableSlotId: slot.id,
              date: targetDate,
            },
          },
          update: {
            absentTeacherId: dto.absentTeacherId,
            substituteTeacherId: candidate.userId,
            status: SubstitutionStatus.AUTO_ASSIGNED,
            lessonPlanUrl: dto.lessonPlanUrl,
            notes: dto.notes,
            notifiedAt: new Date(),
          },
          create: {
            timetableSlotId: slot.id,
            absentTeacherId: dto.absentTeacherId,
            substituteTeacherId: candidate.userId,
            date: targetDate,
            status: SubstitutionStatus.AUTO_ASSIGNED,
            lessonPlanUrl: dto.lessonPlanUrl,
            notes: dto.notes,
            notifiedAt: new Date(),
          },
        });

        // 5. Emit real-time notification to substitute teacher's mobile channel via Redis
        const substituteName = formatUserName(candidate.user);
        const notificationPayload = {
          event: 'SUBSTITUTION_ASSIGNED',
          substitutionId: substitution.id,
          date: dto.date,
          periodNumber: slot.periodNumber,
          time: `${slot.startTime} - ${slot.endTime}`,
          subjectId: slot.subjectId,
          subjectName: slot.subject.nameEn,
          subjectNameAr: slot.subject.nameAr,
          classroomId: slot.classroomId,
          classroomSection: slot.classroom.section,
          absentTeacherName,
          lessonPlanUrl: dto.lessonPlanUrl,
          notes: dto.notes,
          timestamp: new Date().toISOString(),
        };

        try {
          await this.redis.publish(
            `notifications:teacher:${candidate.userId}`,
            JSON.stringify(notificationPayload),
          );
        } catch (err: any) {
          this.logger.warn(
            `Failed to publish Redis notification for substitute teacher ${candidate.userId}: ${err.message}`,
          );
        }

        coveredSlots++;
        assignments.push({
          timetableSlotId: slot.id,
          periodNumber: slot.periodNumber,
          time: `${slot.startTime} - ${slot.endTime}`,
          classroomId: slot.classroomId,
          classroomSection: slot.classroom.section,
          subjectId: slot.subjectId,
          subjectName: slot.subject.nameEn,
          substituteTeacherId: candidate.userId,
          substituteTeacherName: substituteName,
          status: 'AUTO_ASSIGNED',
          substitutionId: substitution.id,
        });

        this.logger.log(
          `Slot Period ${slot.periodNumber} (${slot.subject.nameEn}) auto-assigned to ${substituteName}`,
        );
      } else {
        // No candidate found: record pending substitution for manual intervention
        const pendingSub = await this.prisma.teacherSubstitution.upsert({
          where: {
            timetableSlotId_date: {
              timetableSlotId: slot.id,
              date: targetDate,
            },
          },
          update: {
            absentTeacherId: dto.absentTeacherId,
            substituteTeacherId: null,
            status: SubstitutionStatus.PENDING,
            lessonPlanUrl: dto.lessonPlanUrl,
            notes: dto.notes,
          },
          create: {
            timetableSlotId: slot.id,
            absentTeacherId: dto.absentTeacherId,
            substituteTeacherId: null,
            date: targetDate,
            status: SubstitutionStatus.PENDING,
            lessonPlanUrl: dto.lessonPlanUrl,
            notes: dto.notes,
          },
        });

        uncoveredSlots++;
        assignments.push({
          timetableSlotId: slot.id,
          periodNumber: slot.periodNumber,
          time: `${slot.startTime} - ${slot.endTime}`,
          classroomId: slot.classroomId,
          classroomSection: slot.classroom.section,
          subjectId: slot.subjectId,
          subjectName: slot.subject.nameEn,
          substituteTeacherId: null,
          substituteTeacherName: null,
          status: 'UNASSIGNED',
          substitutionId: pendingSub.id,
          reason: 'No qualified substitute teacher with a free period found in this department',
        });

        this.logger.warn(
          `Slot Period ${slot.periodNumber} (${slot.subject.nameEn}) could not be auto-covered. Flagged as PENDING.`,
        );
      }
    }

    return {
      absentTeacherId: dto.absentTeacherId,
      absentTeacherName,
      date: dto.date,
      dayOfWeek,
      totalSlots: slots.length,
      coveredSlots,
      uncoveredSlots,
      assignments,
    };
  }

  /**
   * Discovers the best eligible substitute teacher for a given slot:
   * 1. Same department.
   * 2. Subject qualifications match (qualifications array has subjectId OR specialisations).
   * 3. Teacher is marked isSubstitutable = true.
   * 4. Free period:
   *    - In TeacherAvailability (isAvailable = true).
   *    - Has NO timetable conflict during that period.
   *    - Has NO existing substitution assignment on that date during that period.
   */
  private async findBestSubstitute(
    departmentId: string,
    subjectId: string,
    subjectName: string,
    absentTeacherProfileId: string,
    tenantId: string,
    dayOfWeek: number,
    periodNumber: number,
    targetDate: Date,
  ) {
    // 1. Fetch candidate teacher profiles in the tenant
    const candidates = await this.prisma.teacherProfile.findMany({
      where: {
        tenantId,
        id: { not: absentTeacherProfileId },
        isSubstitutable: true,
      },
      include: {
        user: {
          include: {
            roles: true,
          },
        },
        availabilities: {
          where: {
            dayOfWeek,
            periodNumber,
          },
        },
      },
    });

    for (const candidate of candidates) {
      // Check 1: Same department
      // A teacher belongs to department via:
      // a) UserRole with matching departmentId or null (school-wide)
      // b) Active timetable slots in that department
      const hasDeptRole = candidate.user.roles.some(
        (ur) => ur.departmentId === departmentId || ur.departmentId === null,
      );

      let inDepartment = hasDeptRole;
      if (!inDepartment) {
        const hasSlotInDept = await this.prisma.timetableSlot.findFirst({
          where: {
            teacherProfileId: candidate.id,
            departmentId,
          },
        });
        inDepartment = !!hasSlotInDept;
      }

      // If candidate has explicit subject qualification for this department's subject
      if (!inDepartment && candidate.qualifications.includes(subjectId)) {
        inDepartment = true;
      }

      if (!inDepartment) {
        continue;
      }

      // Check 2: Qualified for this subject
      const hasSubjectIdQualification = candidate.qualifications.includes(subjectId);
      const hasSpecialisation = candidate.specialisations.some(
        (s) =>
          s.toLowerCase().includes(subjectName.toLowerCase()) ||
          subjectName.toLowerCase().includes(s.toLowerCase()),
      );

      if (!hasSubjectIdQualification && !hasSpecialisation) {
        continue;
      }

      // Check 3: Availability in TeacherAvailability table
      // If records exist for this slot, isAvailable must be true
      if (candidate.availabilities.length > 0) {
        const slotAvail = candidate.availabilities[0];
        if (!slotAvail.isAvailable) {
          continue;
        }
      }

      // Check 4: Collision with candidate's primary timetable
      const timetableConflict = await this.prisma.timetableSlot.findFirst({
        where: {
          teacherProfileId: candidate.id,
          dayOfWeek,
          periodNumber,
        },
      });

      if (timetableConflict) {
        continue; // Already teaching their own class during this period
      }

      // Check 5: Collision with another substitution assigned to candidate today
      const substitutionConflict = await this.prisma.teacherSubstitution.findFirst({
        where: {
          substituteTeacherId: candidate.userId,
          date: targetDate,
          status: { in: [SubstitutionStatus.AUTO_ASSIGNED, SubstitutionStatus.ACCEPTED, SubstitutionStatus.PENDING] },
          timetableSlot: {
            periodNumber,
          },
        },
      });

      if (substitutionConflict) {
        continue; // Already assigned to cover another teacher's class this period
      }

      // Candidate is verified eligible!
      return candidate;
    }

    return null;
  }
}
