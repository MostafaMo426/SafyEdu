import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BusTelemetry,
  BusTelemetryDocument,
} from '../schemas/bus-telemetry.schema';

export interface TelemetryPoint {
  busId: string;
  routeId: string;
  driverId: string;
  matronId?: string;
  longitude: number;
  latitude: number;
  speed?: number;
  heading?: number;
  occupancy?: number;
  batteryLevel?: number;
  tripSessionId?: string;
  timestamp?: Date;
}

export interface LatestBusPosition {
  busId: string;
  routeId: string;
  longitude: number;
  latitude: number;
  speed?: number;
  heading?: number;
  timestamp: Date;
}

@Injectable()
export class BusTelemetryService {
  private readonly logger = new Logger(BusTelemetryService.name);

  constructor(
    @InjectModel(BusTelemetry.name)
    private readonly telemetryModel: Model<BusTelemetryDocument>,
  ) {}

  /**
   * Persist a single telemetry point.
   *
   * Called fire-and-forget from the WebSocket gateway —
   * the gateway does NOT await this.  Any MongoDB write failure
   * is caught here and logged without disrupting the real-time
   * broadcast pipeline.
   */
  async recordPoint(point: TelemetryPoint): Promise<void> {
    try {
      await this.telemetryModel.create({
        busId: point.busId,
        routeId: point.routeId,
        driverId: point.driverId,
        matronId: point.matronId,
        location: {
          type: 'Point',
          coordinates: [point.longitude, point.latitude], // [lng, lat] — GeoJSON order
        },
        speed: point.speed,
        heading: point.heading,
        occupancy: point.occupancy,
        batteryLevel: point.batteryLevel,
        tripSessionId: point.tripSessionId,
        timestamp: point.timestamp ?? new Date(),
      });
    } catch (err) {
      // Log and swallow — telemetry persistence failure must NEVER
      // block the real-time broadcast to 1,800 parent clients.
      this.logger.error(
        `Failed to persist telemetry for bus ${point.busId}`,
        err,
      );
    }
  }

  /**
   * Retrieve the last N telemetry points for a given route.
   * Used by the admin fleet dashboard and trip playback.
   * Covered by index { routeId: 1, timestamp: -1 }.
   */
  async getRecentByRoute(
    routeId: string,
    limit = 50,
  ): Promise<BusTelemetryDocument[]> {
    return this.telemetryModel
      .find({ routeId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Retrieve the last N telemetry points for a specific bus.
   * Covered by index { busId: 1, timestamp: -1 }.
   */
  async getRecentByBus(
    busId: string,
    limit = 100,
  ): Promise<BusTelemetryDocument[]> {
    return this.telemetryModel
      .find({ busId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Spatial proximity query — find buses within `radiusMeters`
   * of a given GPS coordinate.  Used by the geofenced
   * "Arriving Soon" push notification trigger.
   * Powered by the 2dsphere index on `location`.
   */
  async findBusesNear(
    longitude: number,
    latitude: number,
    radiusMeters = 500,
  ): Promise<BusTelemetryDocument[]> {
    // Only consider telemetry from the last 30 seconds (live buses only)
    const cutoff = new Date(Date.now() - 30_000);

    return this.telemetryModel
      .find({
        timestamp: { $gte: cutoff },
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [longitude, latitude] },
            $maxDistance: radiusMeters,
          },
        },
      })
      .lean()
      .exec();
  }

  /**
   * Reconstruct the full path of a completed trip for admin review.
   * Covered by index { tripSessionId: 1, timestamp: 1 }.
   */
  async getTripPath(tripSessionId: string): Promise<BusTelemetryDocument[]> {
    return this.telemetryModel
      .find({ tripSessionId })
      .sort({ timestamp: 1 })
      .lean()
      .exec();
  }
}
