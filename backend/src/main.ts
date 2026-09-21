import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
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

  // ── Socket.IO + Redis Adapter (Horizontal WebSocket Scaling) ────
  // Two dedicated Redis clients for Socket.IO pub/sub.
  // CRITICAL: Socket.IO requires SEPARATE pub and sub clients because
  // a client in subscribe mode cannot issue regular commands.
  // The adapter intercepts server.to(room).emit() calls and routes
  // them through Redis PUBLISH, allowing any pod to broadcast to
  // clients connected to any other pod.
  const redisHost = config.get<string>('redis.host', 'localhost');
  const redisPort = config.get<number>('redis.port', 6379);
  const redisPassword = config.get<string>('redis.password');

  const pubClient = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
  });
  const subClient = pubClient.duplicate();

  // Switch the NestJS WebSocket adapter from the default WsAdapter
  // to Socket.IO so we can use namespaces, rooms, and the Redis adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Attach the Redis adapter to the Socket.IO server instance
  // This must happen after listen() resolves so server.httpServer exists
  app.getHttpServer().on('listening', () => {
    const ioServer = (app as any).httpServer?.io;
    if (ioServer) {
      ioServer.adapter(createAdapter(pubClient, subClient));
    }
  });

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
  console.log(`📡 WebSocket gateway: ws://localhost:${port}/bus-tracking`);
  console.log(`📚 Swagger docs at: http://localhost:${port}/api/docs`);
}

bootstrap();

