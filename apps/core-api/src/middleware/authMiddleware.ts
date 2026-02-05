import { createMiddleware } from 'hono/factory';
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

  // In demo mode (FORCE_DEMO_AUTH=true), bypass auth and use a fixed demo user
  const config = c.var.config;
  console.log('[authMiddleware] FORCE_DEMO_AUTH:', config?.FORCE_DEMO_AUTH, 'config exists:', !!config);
  if (config?.FORCE_DEMO_AUTH) {
    c.set('userId', DEMO_USER.ID);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');

  // Simple mock authentication for non-demo mode
  // NOTE: Mock token only works in demo mode for security
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // Mock token validation - only in demo mode
    if (config?.FORCE_DEMO_AUTH && token === MOCK_USER.TOKEN) {
      c.set('userId', MOCK_USER.ID);
      await next();
      return;
    }

    // TODO: Implement real JWT validation here for production
  }

  // If no valid token, return 401 Unauthorized
  return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
});

export default authMiddleware;
