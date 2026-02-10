import { createMiddleware } from 'hono/factory';
import { Redis } from 'ioredis';
import type { AppBindings } from '../types.js';

let redisClient: Redis | undefined;

function getRedisClient(redisUrl: string): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
    redisClient.on('error', (err: Error) => console.error('Redis Client Error', err));
    console.log('Redis client for rate limiting created.');
  }
  return redisClient;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

const rateLimiter = (options: RateLimitOptions) => {
  const { windowMs, max } = options;

  return createMiddleware(async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      await next();
      return;
    }

    // Use userId from auth middleware if available, otherwise fall back to IP
    const rawUserId = c.get('userId');
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const userId = rawUserId || `ip:${clientIp}`;

    const redisUrl = c.env.REDIS_URL;
    if (!redisUrl) {
      // No Redis configured — fail open (allow request through)
      await next();
      return;
    }

    try {
      const client = getRedisClient(redisUrl);
      const key = `rate_limit:${userId}`;
      const currentTime = Date.now();
      const windowStart = currentTime - windowMs;

      const result = await client.multi()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, currentTime, currentTime)
        .zcard(key)
        .expire(key, Math.ceil(windowMs / 1000))
        .exec();

      const count = result && result[2] && result[2][1] as number;

      if (count && count > max) {
        return c.json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again later.`
        }, 429);
      }
    } catch (err) {
      // Redis unavailable — fail open
      console.warn('Rate limiter Redis error, allowing request:', (err as Error).message);
    }

    await next();
  });
};

export default rateLimiter;
