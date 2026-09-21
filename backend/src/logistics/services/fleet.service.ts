import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { BoardingStatus } from '@prisma/client';
import { ActiveFleetItemDto } from '../dto/fleet.dto';

@Injectable()
export class FleetService {
  private readonly logger = new Logger(FleetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * High-performance Fleet Control Room query.
   *
   * Execution Flow:
   * 1. Query Postgres for all active bus routes belonging to the tenant.
   * 2. Query Redis pipeline MGET for the latest GPS coordinates of all buses simultaneously.
   * 3. Query Postgres for current passenger counts (BOARDED minus ALIGHTED today).
   * 4. Return an optimized flat JSON array for Next.js / MapLibre visualization.
   */
  async getActiveFleet(tenantId: string | null): Promise<ActiveFleetItemDto[]> {
    // ── 1. Query Bus Routes from PostgreSQL ─────────────────────────
    const routeWhere = tenantId ? { tenantId } : {};
    const routes = await this.prisma.busRoute.findMany({
      where: routeWhere,
      select: {
        id: true,
        name: true,
        vehiclePlate: true,
        capacity: true,
        driverName: true,
        driverPhone: true,
        status: true,
      },
      orderBy: { name: 'asc' },
    });

    if (routes.length === 0) {
      return [];
    }

    const routeIds = routes.map((r) => r.id);

    // ── 2. Batch Query Redis GPS Coordinates (MGET) ────────────────
    const redisClient = this.redis.getClient();
    const redisKeys = routeIds.map((id) => `bus:${id}:location`);
    const redisResults = await redisClient.mget(redisKeys);

    const locationMap = new Map<string, any>();
    routeIds.forEach((id, index) => {
      const raw = redisResults[index];
      if (raw) {
        try {
          locationMap.set(id, JSON.parse(raw));
        } catch {
          // ignore corrupted json
        }
      }
    });

    // ── 3. Query PostgreSQL for Current On-Board Passenger Counts ───
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todaysLogs = await this.prisma.boardingLog.findMany({
      where: {
        routeId: { in: routeIds },
        scannedAt: { gte: todayStart },
        status: { in: [BoardingStatus.BOARDED, BoardingStatus.ALIGHTED] },
      },
      select: {
        routeId: true,
        status: true,
      },
    });

    // Calculate Net Passenger Count per route: BOARDED minus ALIGHTED
    const passengerCountMap = new Map<string, number>();
    for (const log of todaysLogs) {
      const current = passengerCountMap.get(log.routeId) ?? 0;
      if (log.status === BoardingStatus.BOARDED) {
        passengerCountMap.set(log.routeId, current + 1);
      } else if (log.status === BoardingStatus.ALIGHTED) {
        passengerCountMap.set(log.routeId, Math.max(0, current - 1));
      }
    }

    // ── 4. Construct Optimized Flat MapLibre Ingestion Array ────────
    return routes.map((route) => {
      const live = locationMap.get(route.id);
      const isOnline = Boolean(live);
      const countFromLogs = passengerCountMap.get(route.id) ?? 0;
      // If live GPS telemetry carries real-time occupancy, prefer it; otherwise fallback to log delta
      const passengerCount =
        typeof live?.occupancy === 'number' ? live.occupancy : countFromLogs;

      return {
        busId: route.id,
        routeId: route.id,
        routeName: route.name,
        vehiclePlate: route.vehiclePlate,
        capacity: route.capacity,
        passengerCount,
        status: route.status,
        driverName: route.driverName ?? undefined,
        driverPhone: route.driverPhone ?? undefined,
        location: live
          ? {
              latitude: live.latitude,
              longitude: live.longitude,
              speed: live.speed ?? undefined,
              heading: live.heading ?? undefined,
              lastUpdated: live.timestamp ?? now.toISOString(),
            }
          : undefined,
        isOnline,
      };
    });
  }
}
