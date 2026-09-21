import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DepartmentType, TermType } from '@prisma/client';
import {
  AmericanGradeResult,
  IGCSEGradeResult,
  NationalGradeResult,
  RecordGradeDto,
  TermGradeResult,
  AssessmentScoreBreakdown,
} from '../dto/grade.dto';

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculates the final grade for a student in a specific subject and term.
   * Dynamically branches based on the department type:
   * - AMERICAN: 4.0 GPA scale (e.g. 93-100 = 4.0 / A)
   * - IGCSE: Cambridge / Edexcel grade boundaries (A*, A, B, C, D, E, U)
   * - NATIONAL: Egyptian MoE requirements (First Term, Second Term, Year Total with Egyptian appreciation ratings)
   */
  async calculateTermGrade(
    studentId: string,
    subjectId: string,
    termId: string,
  ): Promise<TermGradeResult> {
    // 1. Fetch Subject with Department
    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
      include: { department: true },
    });
    if (!subject) {
      throw new NotFoundException(`Subject with ID ${subjectId} not found`);
    }

    // 2. Fetch Term with Academic Year
    const term = await this.prisma.academicTerm.findUnique({
      where: { id: termId },
      include: { academicYear: true },
    });
    if (!term) {
      throw new NotFoundException(`Academic Term with ID ${termId} not found`);
    }

    // 3. Fetch Student
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException(`Student User with ID ${studentId} not found`);
    }

    // 4. Fetch all Grade records for this student, subject, and term
    const grades = await this.prisma.grade.findMany({
      where: {
        studentId,
        subjectId,
        termId,
      },
      include: { assessment: true },
    });

    // 5. Aggregate assessment scores
    const breakdown: AssessmentScoreBreakdown[] = [];
    let calculatedPercentage = 0;

    if (grades.length > 0) {
      let totalWeight = 0;
      let weightedSum = 0;

      for (const g of grades) {
        const marks = Number(g.marksObtained);
        const total = Number(g.assessment.totalMarks);
        const weight = Number(g.assessment.weight);
        const rawPct = total > 0 ? (marks / total) * 100 : 0;

        breakdown.push({
          assessmentId: g.assessmentId,
          title: g.assessment.title,
          marksObtained: marks,
          totalMarks: total,
          weight: weight,
          percentage: Math.round(rawPct * 100) / 100,
        });

        if (weight > 0 && total > 0) {
          totalWeight += weight;
          weightedSum += (marks / total) * weight;
        }
      }

      if (totalWeight > 0) {
        // Normalize weighted sum against total active weight
        calculatedPercentage = (weightedSum / totalWeight) * 100;
      } else {
        // Fall back to unweighted average
        const sumPercentages = breakdown.reduce((acc, b) => acc + b.percentage, 0);
        calculatedPercentage = sumPercentages / grades.length;
      }
    }

    const percentage = Math.round(calculatedPercentage * 100) / 100;
    const departmentType = subject.department.type;

    this.logger.log(
      `Grade calculation: Student ${studentId}, Subject ${subject.code} (${subject.nameEn}), Dept ${departmentType} -> ${percentage}%`,
    );

    // 6. Branch by Curriculum / Department
    switch (departmentType) {
      case DepartmentType.AMERICAN:
        return this.calculateAmericanGrade(
          studentId,
          subjectId,
          subject.nameEn,
          subject.nameAr,
          termId,
          term.label,
          percentage,
          grades.length,
          breakdown,
        );

      case DepartmentType.IGCSE:
        return this.calculateIGCSEGrade(
          studentId,
          subjectId,
          subject.nameEn,
          subject.nameAr,
          termId,
          term.label,
          percentage,
          grades.length,
          breakdown,
        );

      case DepartmentType.NATIONAL:
      case DepartmentType.AZHARI:
      default:
        return this.calculateNationalGrade(
          studentId,
          subjectId,
          subject.nameEn,
          subject.nameAr,
          termId,
          term.label,
          term.type,
          term.academicYearId,
          percentage,
          grades.length,
          breakdown,
        );
    }
  }

  /**
   * American Diploma GPA and Letter Grade calculation:
   * Scale: 4.0
   * 93-100 = 4.0 (A)
   * 90-92.9 = 3.7 (A-)
   * 87-89.9 = 3.3 (B+)
   * 83-86.9 = 3.0 (B)
   * 80-82.9 = 2.7 (B-)
   * 77-79.9 = 2.3 (C+)
   * 73-76.9 = 2.0 (C)
   * 70-72.9 = 1.7 (C-)
   * 67-69.9 = 1.3 (D+)
   * 65-66.9 = 1.0 (D)
   * < 65   = 0.0 (F)
   */
  private calculateAmericanGrade(
    studentId: string,
    subjectId: string,
    nameEn: string,
    nameAr: string,
    termId: string,
    termLabel: string,
    percentage: number,
    assessmentsCount: number,
    breakdown: AssessmentScoreBreakdown[],
  ): AmericanGradeResult {
    let gpa = 0.0;
    let letterGrade = 'F';

    if (percentage >= 93) {
      gpa = 4.0;
      letterGrade = 'A';
    } else if (percentage >= 90) {
      gpa = 3.7;
      letterGrade = 'A-';
    } else if (percentage >= 87) {
      gpa = 3.3;
      letterGrade = 'B+';
    } else if (percentage >= 83) {
      gpa = 3.0;
      letterGrade = 'B';
    } else if (percentage >= 80) {
      gpa = 2.7;
      letterGrade = 'B-';
    } else if (percentage >= 77) {
      gpa = 2.3;
      letterGrade = 'C+';
    } else if (percentage >= 73) {
      gpa = 2.0;
      letterGrade = 'C';
    } else if (percentage >= 70) {
      gpa = 1.7;
      letterGrade = 'C-';
    } else if (percentage >= 67) {
      gpa = 1.3;
      letterGrade = 'D+';
    } else if (percentage >= 65) {
      gpa = 1.0;
      letterGrade = 'D';
    } else {
      gpa = 0.0;
      letterGrade = 'F';
    }

    return {
      track: 'AMERICAN',
      studentId,
      subjectId,
      subjectNameEn: nameEn,
      subjectNameAr: nameAr,
      termId,
      termLabel,
      percentage,
      gpa,
      letterGrade,
      assessmentsCount,
      breakdown,
    };
  }

  /**
   * British Track (IGCSE) Cambridge / Edexcel Grade boundaries:
   * >= 90% = A*
   * >= 80% = A
   * >= 70% = B
   * >= 60% = C
   * >= 50% = D
   * >= 40% = E
   * <  40% = U (Ungraded)
   */
  private calculateIGCSEGrade(
    studentId: string,
    subjectId: string,
    nameEn: string,
    nameAr: string,
    termId: string,
    termLabel: string,
    percentage: number,
    assessmentsCount: number,
    breakdown: AssessmentScoreBreakdown[],
  ): IGCSEGradeResult {
    let letterGrade = 'U';
    let cambridgeBoundary = 'Ungraded (< 40%)';

    if (percentage >= 90) {
      letterGrade = 'A*';
      cambridgeBoundary = 'A* (>= 90%) - Outstanding';
    } else if (percentage >= 80) {
      letterGrade = 'A';
      cambridgeBoundary = 'A (80% - 89.9%) - Excellent';
    } else if (percentage >= 70) {
      letterGrade = 'B';
      cambridgeBoundary = 'B (70% - 79.9%) - Very Good';
    } else if (percentage >= 60) {
      letterGrade = 'C';
      cambridgeBoundary = 'C (60% - 69.9%) - Standard Pass';
    } else if (percentage >= 50) {
      letterGrade = 'D';
      cambridgeBoundary = 'D (50% - 59.9%) - Minimum Pass';
    } else if (percentage >= 40) {
      letterGrade = 'E';
      cambridgeBoundary = 'E (40% - 49.9%) - Low Pass';
    } else {
      letterGrade = 'U';
      cambridgeBoundary = 'U (< 40%) - Ungraded';
    }

    return {
      track: 'IGCSE',
      studentId,
      subjectId,
      subjectNameEn: nameEn,
      subjectNameAr: nameAr,
      termId,
      termLabel,
      percentage,
      letterGrade,
      cambridgeBoundary,
      assessmentsCount,
      breakdown,
    };
  }

  /**
   * Egyptian National Curriculum (MoE) percentage & appreciation ratings:
   * First Term, Second Term, Year Total
   * 85 - 100%: ممتاز (Excellent)
   * 75 - 84.9%: جيد جداً (Very Good)
   * 65 - 74.9%: جيد (Good)
   * 50 - 64.9%: مقبول (Pass)
   * < 50%: دون المستوى (Below Standard)
   */
  private async calculateNationalGrade(
    studentId: string,
    subjectId: string,
    nameEn: string,
    nameAr: string,
    termId: string,
    termLabel: string,
    termType: TermType,
    academicYearId: string,
    percentage: number,
    assessmentsCount: number,
    breakdown: AssessmentScoreBreakdown[],
  ): Promise<NationalGradeResult> {
    const { ratingAr, ratingEn } = this.resolveMoeRating(percentage);
    const passed = percentage >= 50;

    // Retrieve other terms in this academic year for this subject to compute Year Total
    const siblingTerms = await this.prisma.academicTerm.findMany({
      where: {
        academicYearId,
        type: { in: [TermType.SEMESTER_1, TermType.SEMESTER_2] },
      },
    });

    let firstTermPercentage: number | undefined;
    let secondTermPercentage: number | undefined;
    let yearTotalPercentage: number | undefined;
    let yearRatingAr: string | undefined;
    let yearRatingEn: string | undefined;

    if (termType === TermType.SEMESTER_1) {
      firstTermPercentage = percentage;
    } else if (termType === TermType.SEMESTER_2) {
      secondTermPercentage = percentage;
    }

    // Check sibling terms to compute combined year total
    for (const sib of siblingTerms) {
      if (sib.id === termId) continue;
      const sibGrades = await this.prisma.grade.findMany({
        where: { studentId, subjectId, termId: sib.id },
        include: { assessment: true },
      });

      if (sibGrades.length > 0) {
        let totalW = 0;
        let weightedS = 0;
        for (const sg of sibGrades) {
          const m = Number(sg.marksObtained);
          const t = Number(sg.assessment.totalMarks);
          const w = Number(sg.assessment.weight);
          if (w > 0 && t > 0) {
            totalW += w;
            weightedS += (m / t) * w;
          }
        }
        const sibPct =
          totalW > 0
            ? Math.round((weightedS / totalW) * 100 * 100) / 100
            : 0;

        if (sib.type === TermType.SEMESTER_1) {
          firstTermPercentage = sibPct;
        } else if (sib.type === TermType.SEMESTER_2) {
          secondTermPercentage = sibPct;
        }
      }
    }

    if (
      firstTermPercentage !== undefined &&
      secondTermPercentage !== undefined
    ) {
      yearTotalPercentage =
        Math.round(((firstTermPercentage + secondTermPercentage) / 2) * 100) /
        100;
      const yrRatings = this.resolveMoeRating(yearTotalPercentage);
      yearRatingAr = yrRatings.ratingAr;
      yearRatingEn = yrRatings.ratingEn;
    }

    return {
      track: 'NATIONAL',
      studentId,
      subjectId,
      subjectNameEn: nameEn,
      subjectNameAr: nameAr,
      termId,
      termLabel,
      termType: termType.toString(),
      percentage,
      ratingAr,
      ratingEn,
      letterGrade: ratingAr,
      passed,
      firstTermPercentage,
      secondTermPercentage,
      yearTotalPercentage,
      yearRatingAr,
      yearRatingEn,
      assessmentsCount,
      breakdown,
    };
  }

  private resolveMoeRating(percentage: number): { ratingAr: string; ratingEn: string } {
    if (percentage >= 85) {
      return { ratingAr: 'ممتاز', ratingEn: 'Excellent' };
    } else if (percentage >= 75) {
      return { ratingAr: 'جيد جداً', ratingEn: 'Very Good' };
    } else if (percentage >= 65) {
      return { ratingAr: 'جيد', ratingEn: 'Good' };
    } else if (percentage >= 50) {
      return { ratingAr: 'مقبول', ratingEn: 'Pass' };
    } else {
      return { ratingAr: 'دون المستوى', ratingEn: 'Below Standard' };
    }
  }

  /**
   * Records or updates a student's marks for an assessment and auto-derives the letter grade.
   */
  async recordGrade(dto: RecordGradeDto) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: dto.assessmentId },
      include: {
        subject: { include: { department: true } },
        term: true,
      },
    });

    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${dto.assessmentId} not found`);
    }

    const totalMarks = Number(assessment.totalMarks);
    const pct = totalMarks > 0 ? (dto.marksObtained / totalMarks) * 100 : 0;
    const deptType = assessment.subject.department.type;

    let letterGrade = 'N/A';
    if (deptType === DepartmentType.AMERICAN) {
      if (pct >= 93) letterGrade = 'A';
      else if (pct >= 90) letterGrade = 'A-';
      else if (pct >= 87) letterGrade = 'B+';
      else if (pct >= 83) letterGrade = 'B';
      else if (pct >= 80) letterGrade = 'B-';
      else if (pct >= 77) letterGrade = 'C+';
      else if (pct >= 73) letterGrade = 'C';
      else if (pct >= 70) letterGrade = 'C-';
      else if (pct >= 67) letterGrade = 'D+';
      else if (pct >= 65) letterGrade = 'D';
      else letterGrade = 'F';
    } else if (deptType === DepartmentType.IGCSE) {
      if (pct >= 90) letterGrade = 'A*';
      else if (pct >= 80) letterGrade = 'A';
      else if (pct >= 70) letterGrade = 'B';
      else if (pct >= 60) letterGrade = 'C';
      else if (pct >= 50) letterGrade = 'D';
      else if (pct >= 40) letterGrade = 'E';
      else letterGrade = 'U';
    } else {
      const moe = this.resolveMoeRating(pct);
      letterGrade = moe.ratingAr;
    }

    return this.prisma.grade.upsert({
      where: {
        assessmentId_studentId: {
          assessmentId: dto.assessmentId,
          studentId: dto.studentId,
        },
      },
      update: {
        marksObtained: dto.marksObtained,
        letterGrade,
        comments: dto.comments,
      },
      create: {
        assessmentId: dto.assessmentId,
        studentId: dto.studentId,
        subjectId: assessment.subjectId,
        termId: assessment.termId,
        marksObtained: dto.marksObtained,
        letterGrade,
        comments: dto.comments,
      },
    });
  }
}
