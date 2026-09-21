import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password'),
      db: this.config.get<number>('redis.db', 0),
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.client.on('connect', () =>
      this.logger.log('Redis client connected'),
    );
    this.client.on('error', (err) =>
      this.logger.error('Redis error', err),
    );
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis client disconnected');
  }

  // ── Core Operations ─────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  /**
   * Set key with expiry in seconds (SET key value EX ttl).
   */
  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.client.setex(key, Math.ceil(ttlSeconds), value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Publish a message to a Redis Pub/Sub channel.
   * Used by the Bus Telemetry WebSocket Gateway (Phase 2).
   */
  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  /**
   * Expose raw client for advanced use (pipelines, pub/sub subscriptions).
   */
  getClient(): Redis {
    return this.client;
  }
}
