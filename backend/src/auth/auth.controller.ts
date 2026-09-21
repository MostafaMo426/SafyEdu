import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  Delete,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * POST /api/v1/auth/login
   * Authenticates a user with email + password.
   * Returns a short-lived access token and a long-lived refresh token.
   */
  @UseGuards(ThrottlerGuard, LocalAuthGuard)
  @Post('login')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns JWT token pair' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() _dto: LoginDto, @Request() req: any) {
    // LocalAuthGuard has already validated credentials and attached req.user
    return this.auth.login(
      req.user,
      req.headers['user-agent'],
      req.ip,
    );
  }

  /**
   * POST /api/v1/auth/refresh
   * Rotates the refresh token and issues a new token pair.
   */
  @UseGuards(ThrottlerGuard, JwtRefreshGuard)
  @Post('refresh')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get new token pair' })
  @ApiBearerAuth('access-token')
  async refresh(@Body() dto: RefreshDto, @Request() req: any) {
    return this.auth.refreshTokens(
      req.user.sub,
      dto.refreshToken,
      req.headers['user-agent'],
      req.ip,
    );
  }

  /**
   * DELETE /api/v1/auth/logout
   * Revokes the provided refresh token and clears the Redis session.
   */
  @UseGuards(JwtRefreshGuard)
  @Delete('logout')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  @ApiBearerAuth('access-token')
  async logout(@Body() dto: RefreshDto, @Request() req: any) {
    await this.auth.logout(req.user.sub, dto.refreshToken);
  }
}
