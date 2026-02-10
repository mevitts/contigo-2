import { createMiddleware } from 'hono/factory';
import { Redis } from 'ioredis';
import type { AppBindings } from '../types.js'; // Import AppBindings from '@/types'

// A simple in-memory cache for the Redis client to avoid recreating it
let redisClient: Redis | undefined;

// Function to get or create the Redis client
function getRedisClient(redisUrl: string): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl);
    redisClient.on('error', (err: Error) => console.error('Redis Client Error', err));
    console.log('Redis client for rate limiting created.');
  }
  return redisClient;
}

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  max: number;      // Max requests per window per user
}

const rateLimiter = (options: RateLimitOptions) => {
  const { windowMs, max } = options;

  return createMiddleware(async (c, next) => {
    // Never rate-limit CORS preflight; let OPTIONS pass through
    if (c.req.method === 'OPTIONS') {
      await next();
      return;
    }

    // Try to get userId from auth middleware. If missing and we're running in demo/dev
    // allow a demo user id to be used so local development can bypass login.
    const rawUserId = c.get('userId'); // Assuming userId is set by authMiddleware
    const isDev = (c.env.NODE_ENV === 'development' || c.env.DEMO_MODE === 'true');
    const demoUser = c.env.DEMO_USER_ID || 'aaaaaaaa-0000-4000-8000-000000000001';
    const userId = rawUserId || (isDev ? demoUser : undefined);
    if (!userId) {
      // If no userId, rate limit by IP address (requires another middleware to get IP)
      // For now, if no userId and not in demo/dev, return error: all rate-limited routes require auth.
      return c.json({ error: 'Unauthorized', message: 'User ID missing for rate limiting' }, 401);
    }

    const redisUrl = c.env.REDIS_URL; // Assuming REDIS_URL is in c.env
    if (!redisUrl) {
        return c.json({ error: 'Internal Server Error', message: 'Redis URL not configured for rate limiter' }, 500);
    }
    const client = getRedisClient(redisUrl);

    const key = `rate_limit:${userId}`;
    const currentTime = Date.now();
    const windowStart = currentTime - windowMs;

    // Use a multi-command for atomicity:
    // 1. Remove scores older than windowStart (requests outside the window)
    // 2. Add current request timestamp
    // 3. Count requests within the window
    const result = await client.multi()
      .zremrangebyscore(key, 0, windowStart) // Remove old requests
      .zadd(key, currentTime, currentTime)   // Add current request
      .zcard(key)                          // Count remaining requests
      .expire(key, Math.ceil(windowMs / 1000)) // Set/reset expiration for the key
      .exec();

    const count = result && result[2] && result[2][1] as number;

    const requestCount = count as number; // Type assertion

    if (requestCount > max) {
      return c.json({
        error: 'Too Many Requests',
        message: `You have exceeded the rate limit of ${max} requests per ${windowMs / 1000} seconds.`
      }, 429);
    }

    await next();
  });
};

export default rateLimiter;
