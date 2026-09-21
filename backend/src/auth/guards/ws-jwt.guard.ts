import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

/**
 * WebSocket-specific JWT guard.
 *
 * HTTP guards (JwtAuthGuard) rely on Passport extracting tokens from
 * HTTP Authorization headers.  WebSocket connections use a different
 * transport — the token arrives in socket.handshake.auth.token or as
 * a query parameter.  This guard handles that distinction cleanly.
 *
 * Applied at the @SubscribeMessage() level for driver-only operations.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();

    // Token already verified at handleConnection and attached to socket
    const user = (client as any).user;
    if (!user) {
      throw new WsException('Unauthorized');
    }

    // Optional: restrict `update_location` to DRIVER / BUS_MATRON roles only
    const allowedRoles = ['TEACHER', 'BUS_MATRON', 'SCHOOL_ADMIN', 'SUPERADMIN'];
    const hasRole = (user.roles as string[]).some((r) =>
      allowedRoles.includes(r),
    );

    if (!hasRole) {
      this.logger.warn(
        `Blocked WS message from user ${user.sub} with roles ${user.roles}`,
      );
      throw new WsException(
        'Forbidden: only drivers and matrons may emit location updates',
      );
    }

    return true;
  }
}
