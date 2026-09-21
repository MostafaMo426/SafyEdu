import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  // Access token — short-lived (15 minutes)
  accessSecret: process.env.JWT_ACCESS_SECRET,
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',

  // Refresh token — long-lived (7 days), rotated on use
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
}));
