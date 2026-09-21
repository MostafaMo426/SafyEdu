import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { GradeService } from '../src/academic/services/grade.service';
import { SubstitutionService } from '../src/academic/services/substitution.service';
import { PtmService } from '../src/academic/services/ptm.service';
import {
  DepartmentType,
  PTMMode,
  PTMStatus,
  SubstitutionStatus,
  SystemRole,
  TermType,
  UserStatus,
} from '@prisma/client';
import * as assert from 'assert';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import Redis from 'ioredis';

async function runPhase4Tests() {
  console.log('🧪 Starting Phase 4 Academic Engine & Teacher Suite Automated Verification...\n');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: ['error', 'warn'] },
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const gradeService = app.get(GradeService);
  const substitutionService = app.get(SubstitutionService);
  const ptmService = app.get(PtmService);

  const testSuffix = Date.now().toString().slice(-6);

  try {
    // ──────────────────────────────────────────────────────────
    // 0. Seed Foundation Fixtures
    // ──────────────────────────────────────────────────────────
    console.log('1. Setting up academic fixtures (Tenant, Departments, Classrooms, Curriculums)...');

    const tenant = await prisma.tenant.create({
      data: {
        nameAr: `مجمع صفوة التعليمي ${testSuffix}`,
        nameEn: `SafyEdu International Schools ${testSuffix}`,
        slug: `safyedu-intl-${testSuffix}`,
      },
    });

    const academicYear = await prisma.academicYear.create({
      data: {
        tenantId: tenant.id,
        label: `2026/2027 ${testSuffix}`,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-06-30'),
        isCurrent: true,
      },
    });

    // ── Departments ──
    const americanDept = await prisma.department.create({
      data: {
        tenantId: tenant.id,
        type: DepartmentType.AMERICAN,
        nameAr: 'القسم الأمريكي',
        nameEn: 'American High School Diploma',
      },
    });

    const igcseDept = await prisma.department.create({
      data: {
        tenantId: tenant.id,
        type: DepartmentType.IGCSE,
        nameAr: 'القسم البريطاني',
        nameEn: 'British IGCSE Division',
      },
    });

    const nationalDept = await prisma.department.create({
      data: {
        tenantId: tenant.id,
        type: DepartmentType.NATIONAL,
        nameAr: 'القسم الثانوي العام',
        nameEn: 'Egyptian National Secondary',
      },
    });

    // ── Academic Terms ──
    const americanTerm = await prisma.academicTerm.create({
      data: {
        academicYearId: academicYear.id,
        departmentId: americanDept.id,
        type: TermType.SEMESTER_1,
        label: 'Fall Semester 2026',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-20'),
        isActive: true,
      },
    });

    const igcseTerm = await prisma.academicTerm.create({
      data: {
        academicYearId: academicYear.id,
        departmentId: igcseDept.id,
        type: TermType.SEMESTER_1,
        label: 'Autumn Term 2026',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-12-15'),
        isActive: true,
      },
    });

    const nationalTerm1 = await prisma.academicTerm.create({
      data: {
        academicYearId: academicYear.id,
        departmentId: nationalDept.id,
        type: TermType.SEMESTER_1,
        label: 'الفصل الدراسي الأول 2026',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-15'),
        isActive: true,
      },
    });

    const nationalTerm2 = await prisma.academicTerm.create({
      data: {
        academicYearId: academicYear.id,
        departmentId: nationalDept.id,
        type: TermType.SEMESTER_2,
        label: 'الفصل الدراسي الثاني 2027',
        startDate: new Date('2027-02-01'),
        endDate: new Date('2027-06-15'),
        isActive: false,
      },
    });

    // ── Stages, GradeLevels & Classrooms ──
    const americanStage = await prisma.stage.create({
      data: {
        departmentId: americanDept.id,
        nameAr: 'المرحلة الثانوية الأمريكية',
        nameEn: 'High School',
        order: 1,
      },
    });

    const americanGradeLevel = await prisma.gradeLevel.create({
      data: {
        stageId: americanStage.id,
        nameAr: 'الصف العاشر',
        nameEn: 'Grade 10',
        order: 1,
      },
    });

    const americanClassroom = await prisma.classroom.create({
      data: {
        tenantId: tenant.id,
        academicYearId: academicYear.id,
        gradeLevelId: americanGradeLevel.id,
        section: '10-AP-A',
        roomNumber: 'A-201',
      },
    });

    // ── Subjects ──
    const americanSubject = await prisma.subject.create({
      data: {
        tenantId: tenant.id,
        departmentId: americanDept.id,
        code: `AP-CALC-${testSuffix}`,
        nameEn: 'AP Calculus BC',
        nameAr: 'حساب التفاضل والتكامل المتقدم',
        weeklyHours: 5,
      },
    });

    const igcseSubject = await prisma.subject.create({
      data: {
        tenantId: tenant.id,
        departmentId: igcseDept.id,
        code: `0625-PHY-${testSuffix}`,
        nameEn: 'Cambridge IGCSE Physics 0625',
        nameAr: 'الفيزياء كامبردج',
        weeklyHours: 6,
      },
    });

    const nationalSubject = await prisma.subject.create({
      data: {
        tenantId: tenant.id,
        departmentId: nationalDept.id,
        code: `ARAB-10-${testSuffix}`,
        nameEn: 'Arabic Literature & Grammar',
        nameAr: 'اللغة العربية والقصة',
        weeklyHours: 4,
      },
    });

    // ── Students & StudentProfiles ──
    const americanStudentUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `us_student_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'يوسف',
        lastNameAr: 'منصور',
        firstNameEn: 'Youssef',
        lastNameEn: 'Mansour',
        status: UserStatus.ACTIVE,
      },
    });

    const americanStudentProfile = await prisma.studentProfile.create({
      data: {
        userId: americanStudentUser.id,
        tenantId: tenant.id,
        studentCode: `US-STU-${testSuffix}`,
      },
    });

    await prisma.enrollment.create({
      data: {
        studentProfileId: americanStudentProfile.id,
        classroomId: americanClassroom.id,
        academicYearId: academicYear.id,
      },
    });

    const igcseStudentUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `uk_student_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'سلمى',
        lastNameAr: 'الرشيدي',
        firstNameEn: 'Salma',
        lastNameEn: 'El Rashidy',
        status: UserStatus.ACTIVE,
      },
    });

    const igcseStudentProfile = await prisma.studentProfile.create({
      data: {
        userId: igcseStudentUser.id,
        tenantId: tenant.id,
        studentCode: `UK-STU-${testSuffix}`,
      },
    });

    const nationalStudentUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `eg_student_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'أحمد',
        lastNameAr: 'شريف',
        firstNameEn: 'Ahmed',
        lastNameEn: 'Sherif',
        status: UserStatus.ACTIVE,
      },
    });

    const nationalStudentProfile = await prisma.studentProfile.create({
      data: {
        userId: nationalStudentUser.id,
        tenantId: tenant.id,
        studentCode: `EG-STU-${testSuffix}`,
      },
    });

    // ── Teacher Users & Profiles ──
    // Primary Teacher: Mr. Tarek (AP Calculus)
    const tarekTeacherUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `tarek_teacher_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'طارق',
        lastNameAr: 'كمال',
        firstNameEn: 'Tarek',
        lastNameEn: 'Kamal',
        status: UserStatus.ACTIVE,
      },
    });

    const tarekProfile = await prisma.teacherProfile.create({
      data: {
        userId: tarekTeacherUser.id,
        tenantId: tenant.id,
        teacherCode: `TCH-TAR-${testSuffix}`,
        qualifications: [americanSubject.id],
        specialisations: ['Mathematics', 'AP Calculus'],
        isSubstitutable: false,
      },
    });

    // Candidate Substitute: Mr. Sameh (Qualified & Free period)
    const samehTeacherUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `sameh_teacher_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'سامح',
        lastNameAr: 'فوزي',
        firstNameEn: 'Sameh',
        lastNameEn: 'Fawzy',
        status: UserStatus.ACTIVE,
      },
    });

    const samehProfile = await prisma.teacherProfile.create({
      data: {
        userId: samehTeacherUser.id,
        tenantId: tenant.id,
        teacherCode: `TCH-SAM-${testSuffix}`,
        qualifications: [americanSubject.id],
        specialisations: ['Mathematics', 'AP Calculus'],
        isSubstitutable: true,
      },
    });

    // Candidate Substitute 2: Mr. Hany (Qualified, BUT has conflicting timetable slot)
    const hanyTeacherUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `hany_teacher_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'هاني',
        lastNameAr: 'عفيفي',
        firstNameEn: 'Hany',
        lastNameEn: 'Afifi',
        status: UserStatus.ACTIVE,
      },
    });

    const hanyProfile = await prisma.teacherProfile.create({
      data: {
        userId: hanyTeacherUser.id,
        tenantId: tenant.id,
        teacherCode: `TCH-HAN-${testSuffix}`,
        qualifications: [americanSubject.id],
        specialisations: ['Mathematics'],
        isSubstitutable: true,
      },
    });

    const teacherRole = await prisma.role.upsert({
      where: { systemRole: SystemRole.TEACHER },
      update: {},
      create: {
        name: 'Teacher',
        systemRole: SystemRole.TEACHER,
        description: 'Classroom Teacher',
      },
    });

    await prisma.userRole.createMany({
      data: [
        { userId: tarekTeacherUser.id, roleId: teacherRole.id, tenantId: tenant.id, departmentId: americanDept.id },
        { userId: samehTeacherUser.id, roleId: teacherRole.id, tenantId: tenant.id, departmentId: americanDept.id },
        { userId: hanyTeacherUser.id, roleId: teacherRole.id, tenantId: tenant.id, departmentId: americanDept.id },
      ],
    });

    // Timetable Slots:
    // Sunday is dayOfWeek: 0
    // Slot 1: Mr. Tarek teaches AP Calculus in AmericanClassroom, Period 2 (08:45-09:30)
    const tarekTimetableSlot = await prisma.timetableSlot.create({
      data: {
        departmentId: americanDept.id,
        classroomId: americanClassroom.id,
        subjectId: americanSubject.id,
        teacherProfileId: tarekProfile.id,
        dayOfWeek: 0, // Sunday
        periodNumber: 2,
        startTime: '08:45',
        endTime: '09:30',
        roomLabel: 'A-201',
      },
    });

    // Mr. Sameh has explicit free period availability in TeacherAvailability on Sunday Period 2
    await prisma.teacherAvailability.create({
      data: {
        teacherProfileId: samehProfile.id,
        dayOfWeek: 0,
        periodNumber: 2,
        isAvailable: true,
      },
    });

    // Mr. Hany has a conflicting TimetableSlot on Sunday Period 2 in another section
    const conflictClassroom = await prisma.classroom.create({
      data: {
        tenantId: tenant.id,
        academicYearId: academicYear.id,
        gradeLevelId: americanGradeLevel.id,
        section: '10-AP-B',
        roomNumber: 'A-202',
      },
    });

    await prisma.timetableSlot.create({
      data: {
        departmentId: americanDept.id,
        classroomId: conflictClassroom.id,
        subjectId: americanSubject.id,
        teacherProfileId: hanyProfile.id,
        dayOfWeek: 0, // Sunday
        periodNumber: 2, // Conflicting period!
        startTime: '08:45',
        endTime: '09:30',
      },
    });

    // Parents
    const parent1User = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `parent1_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'محمود',
        lastNameAr: 'منصور',
        firstNameEn: 'Mahmoud',
        lastNameEn: 'Mansour',
        status: UserStatus.ACTIVE,
      },
    });

    const parent1Profile = await prisma.parentProfile.create({
      data: {
        userId: parent1User.id,
        tenantId: tenant.id,
      },
    });

    // Link Parent 1 to American Student
    await prisma.parentStudentLink.create({
      data: {
        parentProfileId: parent1Profile.id,
        studentProfileId: americanStudentProfile.id,
        relationship: 'Father',
        isPrimary: true,
      },
    });

    // Parent 2: Second parent also linked to American Student (e.g. Mother)
    const parent2User = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `parent2_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'منى',
        lastNameAr: 'فهمي',
        firstNameEn: 'Mona',
        lastNameEn: 'Fahmy',
        status: UserStatus.ACTIVE,
      },
    });

    const parent2Profile = await prisma.parentProfile.create({
      data: {
        userId: parent2User.id,
        tenantId: tenant.id,
      },
    });

    await prisma.parentStudentLink.create({
      data: {
        parentProfileId: parent2Profile.id,
        studentProfileId: americanStudentProfile.id,
        relationship: 'Mother',
        isPrimary: false,
      },
    });

    console.log('✅ Academic fixtures successfully provisioned.\n');

    // ──────────────────────────────────────────────────────────
    // 1. Task 4.1: Curriculum-Specific Gradebook Engine
    // ──────────────────────────────────────────────────────────
    console.log('2. Testing Task 4.1: Curriculum-Specific Gradebook Engine...');

    // ── Track 1: American Track (GPA 4.0 Scale) ──
    const usMidterm = await prisma.assessment.create({
      data: {
        termId: americanTerm.id,
        subjectId: americanSubject.id,
        createdById: tarekTeacherUser.id,
        title: 'Midterm Exam - Differential Calculus',
        totalMarks: 100,
        weight: 40, // 40%
      },
    });

    const usFinal = await prisma.assessment.create({
      data: {
        termId: americanTerm.id,
        subjectId: americanSubject.id,
        createdById: tarekTeacherUser.id,
        title: 'Final Examination - Integral Calculus',
        totalMarks: 100,
        weight: 60, // 60%
      },
    });

    // Midterm: 95/100, Final: 94/100 -> Weighted = (95*40 + 94*60)/100 = 94.4% -> 4.0 / A
    await gradeService.recordGrade({
      assessmentId: usMidterm.id,
      studentId: americanStudentUser.id,
      marksObtained: 95,
      comments: 'Excellent mastery of derivatives',
    });

    await gradeService.recordGrade({
      assessmentId: usFinal.id,
      studentId: americanStudentUser.id,
      marksObtained: 94,
      comments: 'Strong integration techniques',
    });

    const usGradeResult = await gradeService.calculateTermGrade(
      americanStudentUser.id,
      americanSubject.id,
      americanTerm.id,
    );

    console.log('   American Track Result:', {
      track: usGradeResult.track,
      percentage: usGradeResult.percentage,
      gpa: (usGradeResult as any).gpa,
      letterGrade: (usGradeResult as any).letterGrade,
    });

    assert.strictEqual(usGradeResult.track, 'AMERICAN');
    assert.strictEqual(usGradeResult.percentage, 94.4);
    assert.strictEqual((usGradeResult as any).gpa, 4.0);
    assert.strictEqual((usGradeResult as any).letterGrade, 'A');
    console.log('   ✅ American 4.0 GPA scale conversion validated.\n');

    // ── Track 2: British Track (IGCSE Cambridge Grade Boundaries) ──
    const igcsePaper2 = await prisma.assessment.create({
      data: {
        termId: igcseTerm.id,
        subjectId: igcseSubject.id,
        createdById: tarekTeacherUser.id,
        title: 'Paper 2 Multiple Choice Extended',
        totalMarks: 40,
        weight: 30, // 30%
      },
    });

    const igcsePaper4 = await prisma.assessment.create({
      data: {
        termId: igcseTerm.id,
        subjectId: igcseSubject.id,
        createdById: tarekTeacherUser.id,
        title: 'Paper 4 Theory Extended',
        totalMarks: 80,
        weight: 70, // 70%
      },
    });

    // Paper 2: 38/40 (95%), Paper 4: 72/80 (90%) -> Weighted: 95*0.3 + 90*0.7 = 28.5 + 63 = 91.5% -> A*
    await gradeService.recordGrade({
      assessmentId: igcsePaper2.id,
      studentId: igcseStudentUser.id,
      marksObtained: 38,
      comments: 'High precision on MCQs',
    });

    await gradeService.recordGrade({
      assessmentId: igcsePaper4.id,
      studentId: igcseStudentUser.id,
      marksObtained: 72,
      comments: 'Thorough working shown',
    });

    const igcseGradeResult = await gradeService.calculateTermGrade(
      igcseStudentUser.id,
      igcseSubject.id,
      igcseTerm.id,
    );

    console.log('   IGCSE Track Result:', {
      track: igcseGradeResult.track,
      percentage: igcseGradeResult.percentage,
      letterGrade: (igcseGradeResult as any).letterGrade,
      cambridgeBoundary: (igcseGradeResult as any).cambridgeBoundary,
    });

    assert.strictEqual(igcseGradeResult.track, 'IGCSE');
    assert.strictEqual(igcseGradeResult.percentage, 91.5);
    assert.strictEqual((igcseGradeResult as any).letterGrade, 'A*');
    console.log('   ✅ IGCSE Cambridge grade boundary mapping validated.\n');

    // ── Track 3: Egyptian National Track (MoE Ratings & Year Totals) ──
    const natTerm1Exam = await prisma.assessment.create({
      data: {
        termId: nationalTerm1.id,
        subjectId: nationalSubject.id,
        createdById: tarekTeacherUser.id,
        title: 'امتحان الفصل الدراسي الأول - لغة عربية',
        totalMarks: 100,
        weight: 100,
      },
    });

    const natTerm2Exam = await prisma.assessment.create({
      data: {
        termId: nationalTerm2.id,
        subjectId: nationalSubject.id,
        createdById: tarekTeacherUser.id,
        title: 'امتحان الفصل الدراسي الثاني - لغة عربية',
        totalMarks: 100,
        weight: 100,
      },
    });

    // Term 1: 88/100 (ممتاز), Term 2: 82/100 (جيد جداً) -> Year Total: 85% (ممتاز)
    await gradeService.recordGrade({
      assessmentId: natTerm1Exam.id,
      studentId: nationalStudentUser.id,
      marksObtained: 88,
      comments: 'إتقان تام للنحو والبلاغة',
    });

    await gradeService.recordGrade({
      assessmentId: natTerm2Exam.id,
      studentId: nationalStudentUser.id,
      marksObtained: 82,
      comments: 'أداء متميز في التعبير والقراءة',
    });

    const nationalGradeResult = await gradeService.calculateTermGrade(
      nationalStudentUser.id,
      nationalSubject.id,
      nationalTerm1.id,
    );

    console.log('   National MoE Track Result:', {
      track: nationalGradeResult.track,
      percentage: nationalGradeResult.percentage,
      ratingAr: (nationalGradeResult as any).ratingAr,
      ratingEn: (nationalGradeResult as any).ratingEn,
      firstTermPercentage: (nationalGradeResult as any).firstTermPercentage,
      secondTermPercentage: (nationalGradeResult as any).secondTermPercentage,
      yearTotalPercentage: (nationalGradeResult as any).yearTotalPercentage,
      yearRatingAr: (nationalGradeResult as any).yearRatingAr,
    });

    assert.strictEqual(nationalGradeResult.track, 'NATIONAL');
    assert.strictEqual(nationalGradeResult.percentage, 88);
    assert.strictEqual((nationalGradeResult as any).ratingAr, 'ممتاز');
    assert.strictEqual((nationalGradeResult as any).yearTotalPercentage, 85);
    assert.strictEqual((nationalGradeResult as any).yearRatingAr, 'ممتاز');
    console.log('   ✅ Egyptian MoE percentage and appreciation ratings validated.\n');

    // ──────────────────────────────────────────────────────────
    // 2. Task 4.2: Automated Teacher Substitution Engine (Al-Ihtiyat)
    // ──────────────────────────────────────────────────────────
    console.log('3. Testing Task 4.2: Automated Teacher Substitution Engine (Al-Ihtiyat)...');

    // Setup Redis subscriber to intercept real-time mobile push alert
    const redisSub = redis.getClient().duplicate();

    let receivedNotification: any = null;
    const notificationPromise = new Promise<void>((resolve) => {
      redisSub.subscribe(`notifications:teacher:${samehTeacherUser.id}`);
      redisSub.on('message', (_channel, message) => {
        receivedNotification = JSON.parse(message);
        resolve();
      });
    });

    // Date: 2026-09-27 (Sunday: dayOfWeek = 0)
    const absenceDate = '2026-09-27';
    const lessonPlanUrl = 'https://docs.safyedu.com/plans/ap-calc-derivatives-ch3.pdf';
    const handoffNotes = 'Cover Chain Rule proof and problem set 3.2 (exercises 1 through 10).';

    const absenceResponse = await substitutionService.handleTeacherAbsence({
      absentTeacherId: tarekTeacherUser.id,
      date: absenceDate,
      lessonPlanUrl,
      notes: handoffNotes,
    });

    console.log('   Absence handling response:', {
      absentTeacherName: absenceResponse.absentTeacherName,
      totalSlots: absenceResponse.totalSlots,
      coveredSlots: absenceResponse.coveredSlots,
      assignments: absenceResponse.assignments.map((a) => ({
        periodNumber: a.periodNumber,
        subject: a.subjectName,
        substituteName: a.substituteTeacherName,
        status: a.status,
      })),
    });

    // Verification:
    assert.strictEqual(absenceResponse.totalSlots, 1);
    assert.strictEqual(absenceResponse.coveredSlots, 1);
    assert.strictEqual(absenceResponse.assignments[0].status, 'AUTO_ASSIGNED');
    assert.strictEqual(absenceResponse.assignments[0].substituteTeacherId, samehTeacherUser.id);
    assert.strictEqual(absenceResponse.assignments[0].substituteTeacherName, 'Sameh Fawzy');

    // Verify DB record
    const subRecord = await prisma.teacherSubstitution.findUnique({
      where: {
        timetableSlotId_date: {
          timetableSlotId: tarekTimetableSlot.id,
          date: new Date(`${absenceDate}T00:00:00Z`),
        },
      },
    });
    assert.ok(subRecord, 'TeacherSubstitution record must exist in DB');
    assert.strictEqual(subRecord.status, SubstitutionStatus.AUTO_ASSIGNED);
    assert.strictEqual(subRecord.substituteTeacherId, samehTeacherUser.id);
    assert.strictEqual(subRecord.lessonPlanUrl, lessonPlanUrl);

    // Wait for Redis notification
    await Promise.race([
      notificationPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis notification timed out')), 4000)),
    ]);

    assert.ok(receivedNotification, 'Real-time Redis alert must be published to substitute teacher');
    assert.strictEqual(receivedNotification.event, 'SUBSTITUTION_ASSIGNED');
    assert.strictEqual(receivedNotification.periodNumber, 2);
    assert.strictEqual(receivedNotification.lessonPlanUrl, lessonPlanUrl);
    console.log('   ✅ Substitute matched, DB record persisted, and Redis alert dispatched.\n');

    await redisSub.quit();

    // ──────────────────────────────────────────────────────────
    // 3. Task 4.3: Parent-Teacher Conference (PTM) Slot Booker & Double Booking Prevention
    // ──────────────────────────────────────────────────────────
    console.log('4. Testing Task 4.3: Parent-Teacher Conference (PTM) Slot Booker...');

    // Create active PTM cycle
    const ptmCycle = await ptmService.createCycle({
      termId: americanTerm.id,
      title: 'Fall 2026 Academic Progress Conference',
      date: '2026-10-15',
      mode: PTMMode.PHYSICAL,
      venueInfo: 'School Gymnasium & Building A Classrooms',
      isOpen: true,
    });

    // Create a 10-minute slot for Teacher Mr. Tarek (14:00 - 14:10)
    const slot1 = await ptmService.createSlot({
      cycleId: ptmCycle.id,
      teacherId: tarekTeacherUser.id,
      startTime: '2026-10-15T14:00:00.000Z',
      endTime: '2026-10-15T14:10:00.000Z',
      meetingUrl: 'https://meet.safyedu.com/ptm-tarek-1',
    });

    // ── Test 3A: Parent-Teacher Relationship Validation ──
    console.log('   Testing teacher-student link validation...');
    // Create an unrelated teacher who does not teach the American student
    const unrelatedTeacher = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `unrelated_teacher_${testSuffix}@safyedu.local`,
        passwordHash: 'dummy_hash',
        firstNameAr: 'أشرف',
        lastNameAr: 'منير',
        firstNameEn: 'Ashraf',
        lastNameEn: 'Mounir',
        status: UserStatus.ACTIVE,
      },
    });

    const unrelatedSlot = await ptmService.createSlot({
      cycleId: ptmCycle.id,
      teacherId: unrelatedTeacher.id,
      startTime: '2026-10-15T14:10:00.000Z',
      endTime: '2026-10-15T14:20:00.000Z',
    });

    let forbiddenCaught = false;
    try {
      await ptmService.bookSlot(
        {
          slotId: unrelatedSlot.id,
          studentId: americanStudentUser.id,
          parentId: parent1User.id,
        },
        parent1User.id,
      );
    } catch (err: any) {
      if (err instanceof ForbiddenException) {
        forbiddenCaught = true;
      }
    }
    assert.strictEqual(forbiddenCaught, true, 'Booking teacher who does not teach student must throw ForbiddenException');
    console.log('   ✅ Unauthorized teacher booking rejected with 403 Forbidden.');

    // ── Test 3B: Legitimate Booking ──
    console.log('   Testing valid PTM booking by Parent 1...');
    const booking1 = await ptmService.bookSlot(
      {
        slotId: slot1.id,
        studentId: americanStudentUser.id,
        parentId: parent1User.id,
        notes: 'Discuss AP Calculus performance and upcoming mock exams',
      },
      parent1User.id,
    );

    assert.ok(booking1, 'Booking must succeed');
    assert.strictEqual(booking1.slotId, slot1.id);
    assert.strictEqual(booking1.parentId, parent1User.id);
    assert.strictEqual(booking1.status, PTMStatus.BOOKED);

    const slot1After = await prisma.pTMSlot.findUnique({ where: { id: slot1.id } });
    assert.strictEqual(slot1After?.status, PTMStatus.BOOKED, 'Slot status must be BOOKED');
    console.log('   ✅ Parent 1 successfully booked 10-minute PTM slot.');

    // ── Test 3C: Double-Booking Prevention (409 Conflict) ──
    console.log('   Testing double-booking rejection on the same slot by Parent 2...');
    let conflictCaught = false;
    try {
      await ptmService.bookSlot(
        {
          slotId: slot1.id,
          studentId: americanStudentUser.id,
          parentId: parent2User.id,
          notes: 'Attempting to book already reserved slot',
        },
        parent2User.id,
      );
    } catch (err: any) {
      if (err instanceof ConflictException) {
        conflictCaught = true;
      }
    }
    assert.strictEqual(conflictCaught, true, 'Second parent booking the exact same slot must throw ConflictException (409)');
    console.log('   ✅ Double booking prevented: Second parent rejected with 409 Conflict.');

    // ── Test 3D: High-Concurrency Race Condition Prevention ──
    console.log('   Testing concurrent race condition on an available slot...');
    const slot2 = await ptmService.createSlot({
      cycleId: ptmCycle.id,
      teacherId: tarekTeacherUser.id,
      startTime: '2026-10-15T14:20:00.000Z',
      endTime: '2026-10-15T14:30:00.000Z',
    });

    // Fire concurrent booking requests from Parent 1 and Parent 2 simultaneously
    const [resultA, resultB] = await Promise.allSettled([
      ptmService.bookSlot(
        { slotId: slot2.id, studentId: americanStudentUser.id, parentId: parent1User.id },
        parent1User.id,
      ),
      ptmService.bookSlot(
        { slotId: slot2.id, studentId: americanStudentUser.id, parentId: parent2User.id },
        parent2User.id,
      ),
    ]);

    const successes = [resultA, resultB].filter((r) => r.status === 'fulfilled');
    const failures = [resultA, resultB].filter((r) => r.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent booking must succeed');
    assert.strictEqual(failures.length, 1, 'Exactly one concurrent booking must fail');

    const failedReason: any = (failures[0] as PromiseRejectedResult).reason;
    assert.ok(
      failedReason instanceof ConflictException,
      'Failed concurrent request must be ConflictException',
    );

    const slot2Bookings = await prisma.pTMBooking.findMany({ where: { slotId: slot2.id } });
    assert.strictEqual(slot2Bookings.length, 1, 'Database must have exactly 1 booking record for the slot');
    console.log('   ✅ Concurrency lock validated: 1 winner, 1 rejected with 409 Conflict, 0 duplicate bookings.\n');

    console.log('🎉 ALL PHASE 4 INTEGRATION TESTS PASSED PERFECTLY!\n');
  } catch (err) {
    console.error('❌ Phase 4 Verification Failed:', err);
    throw err;
  } finally {
    await app.close();
  }
}

runPhase4Tests()
  .then(() => {
    console.log('Execution finished successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
