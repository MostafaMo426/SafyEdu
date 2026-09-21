import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import type { User } from '@prisma/client';

export interface JwtPayload {
  sub: string;       // User UUID
  email: string;
  tenantId: string | null;
  roles: string[];   // SystemRole[] as strings
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expiry
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  Validate user credentials (called by LocalStrategy)
  // ──────────────────────────────────────────────────────────────
  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException(
        'Your account has been suspended. Contact your school administrator.',
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  // ──────────────────────────────────────────────────────────────
  //  Login — issue token pair and store refresh token
  // ──────────────────────────────────────────────────────────────
  async login(
    user: User,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<TokenPair> {
    const roles = await this.getUserRoles(user.id);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.issueRefreshToken(user.id, deviceInfo, ipAddress);

    // Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Cache active session in Redis for fast guard lookups
    const accessExpiresIn = this.getAccessExpiresInSeconds();
    await this.redis.setex(
      `session:${user.id}`,
      accessExpiresIn,
      JSON.stringify(payload),
    );

    return { accessToken, refreshToken, expiresIn: accessExpiresIn };
  }

  // ──────────────────────────────────────────────────────────────
  //  Refresh token rotation
  // ──────────────────────────────────────────────────────────────
  async refreshTokens(
    userId: string,
    incomingRefreshToken: string,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<TokenPair> {
    const tokenHash = await argon2.hash(incomingRefreshToken);

    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        userId,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!stored) {
      // Possible token reuse — revoke ALL tokens for this user (security measure)
      await this.revokeAllRefreshTokens(userId);
      throw new UnauthorizedException(
        'Refresh token invalid or reused. All sessions revoked.',
      );
    }

    // Revoke old token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.login(stored.user, deviceInfo, ipAddress);
  }

  // ──────────────────────────────────────────────────────────────
  //  Logout — revoke specific refresh token and clear Redis session
  // ──────────────────────────────────────────────────────────────
  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = await argon2.hash(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash },
      data: { revokedAt: new Date() },
    });
    await this.redis.del(`session:${userId}`);
  }

  // ──────────────────────────────────────────────────────────────
  //  Internal helpers
  // ──────────────────────────────────────────────────────────────
  private async issueRefreshToken(
    userId: string,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<string> {
    const rawToken = nanoid(64); // Cryptographically random
    const tokenHash = await argon2.hash(rawToken);
    const refreshExpiresIn = this.config.get<string>(
      'jwt.refreshExpiresIn',
      '7d',
    );
    const expiresAt = this.parseExpiry(refreshExpiresIn);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, deviceInfo, ipAddress, expiresAt },
    });

    return rawToken;
  }

  private async getUserRoles(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return userRoles.map((ur) => ur.role.systemRole);
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.redis.del(`session:${userId}`);
  }

  private getAccessExpiresInSeconds(): number {
    const raw = this.config.get<string>('jwt.accessExpiresIn', '15m');
    return this.parseExpiry(raw).getTime() / 1000 - Date.now() / 1000;
  }

  private parseExpiry(expiry: string): Date {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1), 10);
    const ms =
      unit === 'd' ? value * 86_400_000 :
      unit === 'h' ? value * 3_600_000 :
      unit === 'm' ? value * 60_000 : value * 1_000;
    return new Date(Date.now() + ms);
  }
}
