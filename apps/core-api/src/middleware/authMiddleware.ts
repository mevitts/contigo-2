import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import type { Config } from '../config.js';
import { DEMO_USER, MOCK_USER } from '../constants.js';

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

  const config = c.var.config;

  // In demo mode (FORCE_DEMO_AUTH=true), bypass auth and use a fixed demo user
  if (config?.FORCE_DEMO_AUTH) {
    c.set('userId', DEMO_USER.ID);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // Mock token validation - only in demo mode
    if (config?.FORCE_DEMO_AUTH && token === MOCK_USER.TOKEN) {
      c.set('userId', MOCK_USER.ID);
      await next();
      return;
    }

    // Production JWT validation using VOICE_ENGINE_SECRET (shared HMAC secret)
    const secret = config?.VOICE_ENGINE_SECRET;
    if (secret) {
      try {
        const secretKey = new TextEncoder().encode(secret);
        const { payload } = await jose.jwtVerify(token, secretKey, {
          issuer: 'urn:contigo:core-api',
          audience: 'urn:contigo:voice-engine',
        });

        if (payload.sub) {
          c.set('userId', payload.sub);
          await next();
          return;
        }
      } catch (err) {
        // Token invalid or expired — fall through to 401
      }
    }
  }

  // If no valid token, return 401 Unauthorized
  return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
});

export default authMiddleware;
