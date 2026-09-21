import { Module } from '@nestjs/common';
import { GradeService } from './services/grade.service';
import { SubstitutionService } from './services/substitution.service';
import { PtmService } from './services/ptm.service';
import { AcademicController } from './controllers/academic.controller';
import { PtmController } from './controllers/ptm.controller';

@Module({
  controllers: [AcademicController, PtmController],
  providers: [GradeService, SubstitutionService, PtmService],
  exports: [GradeService, SubstitutionService, PtmService],
})
export class AcademicModule {}
