import Redis from 'ioredis';
import { getConfig } from './index';
import { logger } from '../utils/logger';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;

  const config = getConfig();

  redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on('connect', () => {
    logger.info('Redis connected');
  });

  redis.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redis;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedis();
  await client.connect();
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis disconnected gracefully');
  }
}
