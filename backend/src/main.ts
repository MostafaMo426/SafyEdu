import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  const config = app.get(ConfigService);

  // ── Global Validation ────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,        // Strip unknown properties
      forbidNonWhitelisted: true,
      transform: true,        // Auto-cast primitives
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── URI Versioning ───────────────────────────────────────────────
  app.enableVersioning({ type: VersioningType.URI });

  // ── CORS ────────────────────────────────────────────────────────
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', '*'),
    credentials: true,
  });

  // ── Global prefix ───────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Swagger (OpenAPI) ────────────────────────────────────────────
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SafyEdu API')
      .setDescription(
        'Multi-Tenant School Management SaaS — REST API Documentation',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 SafyEdu API running on: http://localhost:${port}/api`);
  console.log(`📚 Swagger docs at: http://localhost:${port}/api/docs`);
}

bootstrap();
