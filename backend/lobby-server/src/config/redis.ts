import { Redis } from 'ioredis';
import { getConfig } from '@flicker/config';

const { redis } = getConfig();

export const redisClient = new Redis({
  host: redis.host,
  port: redis.port,
  lazyConnect: true,
  maxRetriesPerRequest: null,
});

redisClient.on('error', (err: Error) => {
  console.error('[redis] error:', err.message);
});
