import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BusTelemetry, BusTelemetrySchema } from './schemas/bus-telemetry.schema';
import { BusTelemetryService } from './services/bus-telemetry.service';
import { BusTrackingGateway } from './gateways/bus-tracking.gateway';
import { BoardingService } from './services/boarding.service';
import { AbsenceService } from './services/absence.service';
import { FleetService } from './services/fleet.service';
import { BoardingController } from './controllers/boarding.controller';
import { AbsenceController } from './controllers/absence.controller';
import { FleetController } from './controllers/fleet.controller';

@Module({
  imports: [
    // Register the BusTelemetry Mongoose model scoped to this module
    MongooseModule.forFeature([
      { name: BusTelemetry.name, schema: BusTelemetrySchema },
    ]),

    // JWT needed by WsJwtGuard and BusTrackingGateway token verification
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret'),
        signOptions: { expiresIn: config.get<string>('jwt.accessExpiresIn') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [BoardingController, AbsenceController, FleetController],
  providers: [
    BusTelemetryService,
    BusTrackingGateway,
    BoardingService,
    AbsenceService,
    FleetService,
  ],
  exports: [
    BusTelemetryService,
    BusTrackingGateway,
    BoardingService,
    AbsenceService,
    FleetService,
  ],
})
export class LogisticsModule {}

