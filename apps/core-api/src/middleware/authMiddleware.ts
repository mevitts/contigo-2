import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import type { Config } from '../config.js';
import { DEMO_USER } from '../constants.js';

export interface AuthContext {
  userId: string;
}

type MiddlewareEnv = { Variables: { config: Config; userId: string } };

const authMiddleware = createMiddleware<MiddlewareEnv>(async (c, next) => {
  // Always allow CORS preflight to go through without auth
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }

  // In demo mode (FORCE_DEMO_AUTH=true), bypass auth and use a fixed demo user
  const config = c.var.config;
  console.log('[authMiddleware] FORCE_DEMO_AUTH:', config?.FORCE_DEMO_AUTH, 'config exists:', !!config);
  if (config?.FORCE_DEMO_AUTH) {
    c.set('userId', DEMO_USER.ID);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const secret = config?.JWT_SECRET || (c.env as any)?.VOICE_ENGINE_SECRET;

    if (secret) {
      try {
        const key = new TextEncoder().encode(secret);
        const { payload } = await jose.jwtVerify(token, key, {
          issuer: 'urn:contigo:core-api',
        });

        if (payload.sub) {
          c.set('userId', payload.sub);
          await next();
          return;
        }
      } catch (err) {
        console.warn('[authMiddleware] JWT verification failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  // If no valid token, return 401 Unauthorized
  return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
});

export default authMiddleware;
