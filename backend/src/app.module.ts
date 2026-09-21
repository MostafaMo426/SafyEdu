import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';

@Module({
  imports: [
    // ── Configuration ──────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig, redisConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Rate Limiting (global) ─────────────────────────────────────
    // 100 requests per 60 seconds per IP by default.
    // Auth routes are tightened further in AuthModule.
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60_000, limit: 100 },
    ]),

    // ── Database ───────────────────────────────────────────────────
    PrismaModule,

    // ── Feature Modules ────────────────────────────────────────────
    AuthModule,
    TenantModule,
  ],
})
export class AppModule {}
