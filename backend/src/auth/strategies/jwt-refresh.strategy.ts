import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtPayload } from '../auth.service';

/**
 * Used only by the /auth/refresh and /auth/logout endpoints.
 * Extracts the access token from the Authorization header but
 * validates against the REFRESH secret — preventing access tokens
 * from being used to generate new tokens.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  validate(_req: Request, payload: JwtPayload) {
    // Minimal validation — refresh tokens are opaque nanoid strings
    // stored in DB; the real validation is in AuthService.refreshTokens
    return payload;
  }
}
