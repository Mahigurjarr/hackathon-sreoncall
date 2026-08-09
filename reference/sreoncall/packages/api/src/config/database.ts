import mongoose from 'mongoose';
import { getConfig } from './index';
import { logger } from '../utils/logger';
import { setupMongooseMonitoring } from '../middleware/metrics.middleware';

let isConnected = false;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (isConnected) return mongoose;

  const config = getConfig();

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info('MongoDB connected');
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
  });

  const conn = await mongoose.connect(config.MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    heartbeatFrequencyMS: 10000,
    monitorCommands: true,
  });

  // Attach Prometheus command monitoring to the MongoDB driver
  setupMongooseMonitoring();

  logger.info('MongoDB connection established', {
    host: conn.connection.host,
    name: conn.connection.name,
  });

  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info('MongoDB disconnected gracefully');
}

export function isDatabaseConnected(): boolean {
  return isConnected;
}
