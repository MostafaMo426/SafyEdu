import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { JwtPayload } from '../auth.service';

/**
 * Guards routes requiring a valid, non-expired access token.
 * Additionally validates that the user session still exists in Redis
 * (allows instant revocation without waiting for token expiry).
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    // Fast Redis session check — O(1) lookup
    const cached = await this.redis.get(`session:${payload.sub}`);
    if (!cached) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    // Confirm user still active in DB (infrequent check acceptable here)
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, tenantId: true, status: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is not active');
    }

    return payload; // Attached to request as req.user
  }
}
