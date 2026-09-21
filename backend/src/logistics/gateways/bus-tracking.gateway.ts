import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { UseGuards, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/redis/redis.service';
import { BusTelemetryService, TelemetryPoint } from '../services/bus-telemetry.service';
import { WsJwtGuard } from '../../auth/guards/ws-jwt.guard';
import { IsNumber, IsString, IsOptional, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

// ─────────────────────────────────────────────────────────────
//  BusTrackingGateway — Real-Time GPS WebSocket Gateway
//
//  Connection Model
//  ────────────────
//  • Driver/Matron app: connects and emits `update_location`
//    events at ~1-second intervals.
//
//  • Parent app: connects and joins room `bus_route_{routeId}`.
//    Receives `location_update` broadcasts passively.
//
//  Why Redis Pub/Sub does NOT block the Event Loop
//  ────────────────────────────────────────────────
//  With 1,800+ simultaneous parent connections the naive approach
//  of iterating `server.to(room).emit(...)` inside the Node.js
//  process creates O(n) socket write syscalls per GPS tick — all
//  synchronous within one event loop tick, causing measurable lag.
//
//  Instead, we use the @socket.io/redis-adapter:
//
//    Driver → Gateway (1 event)
//       └→ Redis PUBLISH bus_room_{routeId}  (1 network write)
//             └→ Redis broadcasts to ALL subscribed Socket.IO nodes
//                   └→ Each node writes only to its own local clients
//
//  This achieves three things:
//  1. The gateway process does ONE Redis publish, not N socket writes.
//     Fan-out is offloaded to Redis, which runs on a separate OS thread.
//  2. Horizontal scaling: any number of API pods can share the same
//     Socket.IO room state via Redis without sticky sessions.
//  3. The Node.js event loop returns immediately; all parent writes
//     happen asynchronously across Redis → Socket.IO's internal queue.
//
//  Redis Key Schema
//  ────────────────
//  bus:{busId}:location  STRING  Latest coordinate JSON (fast poll fallback)
//  bus:{busId}:trip      STRING  Current tripSessionId
//  bus:{routeId}:online  SET     Set of connected driver socket IDs
// ─────────────────────────────────────────────────────────────

/** Payload shape validated on every `update_location` emission */
class UpdateLocationDto {
  @IsString()
  busId: string;

  @IsString()
  routeId: string;

  @IsNumber()
  longitude: number;

  @IsNumber()
  latitude: number;

  @IsOptional()
  @IsNumber()
  speed?: number;

  @IsOptional()
  @IsNumber()
  heading?: number;

  @IsOptional()
  @IsNumber()
  occupancy?: number;

  @IsOptional()
  @IsNumber()
  batteryLevel?: number;

  @IsOptional()
  @IsString()
  tripSessionId?: string;
}

/** Client joins this room to subscribe to a specific route's updates */
class JoinRouteDto {
  @IsString()
  routeId: string;
}

@WebSocketGateway({
  namespace: '/bus-tracking',
  cors: {
    origin: '*', // Tighten in production via environment variable
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class BusTrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BusTrackingGateway.name);

  // In-memory map: socketId → { busId, routeId } for disconnect cleanup
  private readonly driverSessions = new Map<
    string,
    { busId: string; routeId: string }
  >();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly telemetryService: BusTelemetryService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('BusTrackingGateway initialised on /bus-tracking');
  }

  // ──────────────────────────────────────────────────────────
  //  Connection Lifecycle
  // ──────────────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const user = this.extractAndVerifyToken(client);
      // Attach decoded JWT payload to the socket for downstream use
      (client as any).user = user;
      this.logger.debug(`Client connected: ${client.id} (${user.email})`);
    } catch {
      this.logger.warn(`Rejected unauthenticated connection: ${client.id}`);
      client.emit('error', { message: 'Unauthorized — provide a valid JWT' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const session = this.driverSessions.get(client.id);
    if (session) {
      // Mark bus as offline in Redis
      await this.redis.del(`bus:${session.busId}:location`);
      await this.redis.del(`bus:${session.busId}:trip`);
      this.driverSessions.delete(client.id);
      this.logger.log(
        `Driver disconnected: bus ${session.busId} on route ${session.routeId}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  //  Parent: Subscribe to a Route Room
  // ──────────────────────────────────────────────────────────

  /**
   * Parents call this after connecting.
   * Joins the Socket.IO room for the given route.
   * They will then receive `location_update` events automatically.
   *
   * Emits the last known bus position from Redis as an immediate
   * snapshot so the parent sees the bus instantly on map open,
   * without waiting for the next GPS tick.
   */
  @SubscribeMessage('subscribe_route')
  async handleSubscribeRoute(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRouteDto,
  ) {
    const validated = plainToInstance(JoinRouteDto, data);
    const errors = validateSync(validated);
    if (errors.length > 0) {
      throw new WsException('Invalid subscribe_route payload');
    }

    const room = this.routeRoom(validated.routeId);
    await client.join(room);
    this.logger.debug(`Client ${client.id} joined room ${room}`);

    // Snapshot: send last known position from Redis (O(1) lookup)
    const cached = await this.redis.get(`bus:${validated.routeId}:location`);
    if (cached) {
      client.emit('location_snapshot', JSON.parse(cached));
    }

    return { status: 'subscribed', room };
  }

  /**
   * Parent can unsubscribe from a route (e.g., when switching children).
   */
  @SubscribeMessage('unsubscribe_route')
  async handleUnsubscribeRoute(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRouteDto,
  ) {
    const room = this.routeRoom(data.routeId);
    await client.leave(room);
    return { status: 'unsubscribed', room };
  }

  // ──────────────────────────────────────────────────────────
  //  Driver / Matron: Emit GPS Location
  // ──────────────────────────────────────────────────────────

  /**
   * Core telemetry ingestion handler.
   *
   * Execution path (all non-blocking):
   *  1. Validate payload shape (sync, <1ms)
   *  2. Compose broadcast payload
   *  3. Fire-and-forget: persist to MongoDB      ← does NOT block
   *  4. Fire-and-forget: update Redis latest key ← does NOT block
   *  5. Broadcast to route room via Socket.IO    ← Redis adapter fan-out
   *
   * Steps 3 and 4 are deliberately not awaited.  The event loop
   * returns to accept the next incoming GPS frame while MongoDB
   * and Redis handle the I/O in parallel on libuv's thread pool.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('update_location')
  async handleUpdateLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UpdateLocationDto,
  ) {
    // ── 1. Validate ─────────────────────────────────────────
    const dto = plainToInstance(UpdateLocationDto, data);
    const errors = validateSync(dto);
    if (errors.length > 0) {
      throw new WsException('Invalid update_location payload');
    }

    const user = (client as any).user;
    const now = new Date();

    // Register driver session for disconnect cleanup
    if (!this.driverSessions.has(client.id)) {
      this.driverSessions.set(client.id, {
        busId: dto.busId,
        routeId: dto.routeId,
      });
      this.logger.log(
        `Driver registered: bus ${dto.busId} → route ${dto.routeId}`,
      );
    }

    // ── 2. Compose broadcast payload ─────────────────────────
    const broadcastPayload = {
      busId: dto.busId,
      routeId: dto.routeId,
      longitude: dto.longitude,
      latitude: dto.latitude,
      speed: dto.speed,
      heading: dto.heading,
      occupancy: dto.occupancy,
      timestamp: now.toISOString(),
    };

    // ── 3. MongoDB persist — fire-and-forget ─────────────────
    // Deliberately NOT awaited.  Failure is caught inside the service.
    const telemetryPoint: TelemetryPoint = {
      busId: dto.busId,
      routeId: dto.routeId,
      driverId: user.sub,
      matronId: dto.tripSessionId ? undefined : undefined,
      longitude: dto.longitude,
      latitude: dto.latitude,
      speed: dto.speed,
      heading: dto.heading,
      occupancy: dto.occupancy,
      batteryLevel: dto.batteryLevel,
      tripSessionId: dto.tripSessionId,
      timestamp: now,
    };
    this.telemetryService.recordPoint(telemetryPoint); // no await

    // ── 4. Redis latest-position cache — fire-and-forget ──────
    // TTL of 120s: if the bus stops broadcasting, the key auto-expires
    // and parents see a "signal lost" state rather than stale data.
    this.redis.setex(
      `bus:${dto.busId}:location`,
      120,
      JSON.stringify(broadcastPayload),
    ); // no await

    if (dto.tripSessionId) {
      this.redis.setex(
        `bus:${dto.busId}:trip`,
        43_200, // 12 hours
        dto.tripSessionId,
      ); // no await
    }

    // ── 5. Broadcast via Socket.IO room (Redis adapter fan-out) ──
    // `this.server.to(room).emit()` publishes ONE message to Redis.
    // The @socket.io/redis-adapter subscribers on every pod then
    // fan out to their own locally connected clients — decoupled
    // from THIS process's event loop entirely.
    const room = this.routeRoom(dto.routeId);
    this.server.to(room).emit('location_update', broadcastPayload);

    // Acknowledge back to the driver client (optional, helps debug)
    return { status: 'ok', serverTime: now.toISOString() };
  }

  // ──────────────────────────────────────────────────────────
  //  Admin: Request Latest Position Snapshot
  // ──────────────────────────────────────────────────────────

  @SubscribeMessage('get_bus_location')
  async handleGetBusLocation(
    @ConnectedSocket() _client: Socket,
    @MessageBody() data: { busId: string },
  ) {
    const cached = await this.redis.get(`bus:${data.busId}:location`);
    if (!cached) {
      return { status: 'offline', busId: data.busId };
    }
    return { status: 'online', ...JSON.parse(cached) };
  }

  // ──────────────────────────────────────────────────────────
  //  Real-Time Logistics Events (Boarding & Absence)
  // ──────────────────────────────────────────────────────────

  /**
   * Broadcast an NFC tap boarding/alighting event to:
   * 1. Route room (`bus_route_${routeId}`)
   * 2. Specific parent rooms (`parent_${parentId}`)
   * 3. Redis Pub/Sub channel `logistics:boarding_events`
   */
  async broadcastBoardingEvent(event: {
    routeId: string;
    studentId: string;
    studentName: string;
    busId: string;
    vehiclePlate?: string;
    status: string;
    direction: string;
    timestamp: string;
    location?: { lat: number; lng: number };
    parentUserIds?: string[];
    message: string;
  }) {
    // 1. Emit to route room (for matron, driver, and watching parents)
    const room = this.routeRoom(event.routeId);
    if (this.server) {
      this.server.to(room).emit('student_boarded', event);

      // 2. Emit directly to each parent's personal socket room
      if (event.parentUserIds && event.parentUserIds.length > 0) {
        for (const parentId of event.parentUserIds) {
          this.server.to(`parent_${parentId}`).emit('boarding_notification', event);
          this.server.to(`user_${parentId}`).emit('boarding_notification', event);
        }
      }
    }

    // 3. Publish to Redis Pub/Sub channel for multi-pod WebSocket scaling
    await this.redis.publish('logistics:boarding_events', JSON.stringify(event));
    await this.redis.publish('parent_notifications', JSON.stringify(event));
  }

  /**
   * Broadcast a student absence event to the driver and route room
   * so the mobile navigation dynamically skips that house/stop.
   */
  async broadcastAbsenceEvent(event: {
    routeId: string;
    studentId: string;
    studentName: string;
    stopId?: string;
    date: string;
    round: string;
    reason?: string;
    message: string;
  }) {
    const room = this.routeRoom(event.routeId);
    if (this.server) {
      this.server.to(room).emit('student_absence', event);
    }

    // Publish to Redis Pub/Sub channel
    await this.redis.publish('logistics:absence_events', JSON.stringify(event));
  }

  // ──────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────

  private routeRoom(routeId: string): string {
    return `bus_route_${routeId}`;
  }

  /**
   * Extracts and verifies the JWT from:
   *   socket.handshake.auth.token    (preferred — mobile SDK)
   *   socket.handshake.headers.authorization  (Bearer fallback)
   */
  private extractAndVerifyToken(client: Socket): any {
    const authToken: string =
      client.handshake.auth?.token ??
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!authToken) throw new WsException('No token provided');

    return this.jwtService.verify(authToken, {
      secret: this.config.get<string>('jwt.accessSecret'),
    });
  }
}
