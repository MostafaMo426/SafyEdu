import { registerAs } from '@nestjs/config';

export default registerAs('mongodb', () => ({
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/safyedu_telemetry',
  user: process.env.MONGO_USER,
  password: process.env.MONGO_PASSWORD,
}));
