import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { MongooseModule } from '@nestjs/mongoose';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { LogisticsModule } from './logistics/logistics.module';
import { FinanceModule } from './finance/finance.module';
import { CanteenModule } from './canteen/canteen.module';
import { AcademicModule } from './academic/academic.module';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';
import mongodbConfig from './config/mongodb.config';

@Module({
  imports: [
    // ── Configuration ──────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig, redisConfig, mongodbConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Rate Limiting (global) ─────────────────────────────────────
    // 100 requests per 60 seconds per IP by default.
    // Auth routes are tightened further in AuthModule.
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60_000, limit: 100 },
    ]),

    // ── PostgreSQL (Prisma) ────────────────────────────────────────
    PrismaModule,

    // ── MongoDB (Mongoose) ─────────────────────────────────────────
    // High-velocity telemetry, audit logs, and push notification queues.
    // Connection URI is resolved from the config service so it can vary
    // across environments (dev → docker, staging → Atlas, prod → Atlas).
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodb.uri'),
        // Recommended production options
        maxPoolSize: 20,          // Max concurrent Mongo connections per pod
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        // Mongoose-level settings
        autoIndex: true,          // Build indexes declared in schemas on startup
      }),
      inject: [ConfigService],
    }),

    // ── Feature Modules ────────────────────────────────────────────
    AuthModule,
    TenantModule,
    LogisticsModule,
    FinanceModule,
    CanteenModule,
    AcademicModule,
  ],
})
export class AppModule {}
