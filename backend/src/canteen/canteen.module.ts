import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { DietaryController } from './controllers/dietary.controller';
import { CanteenController } from './controllers/canteen.controller';

@Module({
  imports: [FinanceModule],
  controllers: [DietaryController, CanteenController],
})
export class CanteenModule {}
