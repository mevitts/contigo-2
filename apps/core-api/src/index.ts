import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Context, Env } from 'hono';
import auth from './routes/auth.js';
import sessions from './routes/sessions.js';
import voice from './routes/voice.js';
import sessionToken from './routes/session-token.js';
import learningNotes from './routes/learning-notes.js';
import { loadConfig } from './config.js';
import authMiddleware from './middleware/authMiddleware.js';
import rateLimiter from './middleware/rateLimiter.js';
import type { AppBindings } from './types.js';
import type { DbEnv } from './services/auth_service.js';

const app = new Hono<{ Bindings: AppBindings }>();
const bindings = process.env as unknown as DbEnv;

// Load config once at startup
const config = loadConfig(bindings);

// Parse CORS allowed origins from config
const corsOrigins = config.CORS_ALLOWED_ORIGINS
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
app.use('*', secureHeaders());

// CORS middleware - origins configurable via CORS_ALLOWED_ORIGINS env var
app.use('/*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Middleware to make config available to all routes
app.use('*', async (c: Context, next) => {
  c.set('config', config);
  await next();
});

app.get('/healthz', (c) => {
  return c.text('OK');
});

// Rate limit unauthenticated endpoints (login/callback brute-force protection)
app.use('/auth/*', rateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/v1/session-token/*', rateLimiter({ windowMs: 60 * 1000, max: 30 }));

// Routes that do not require authentication
app.route('/auth', auth);
app.route('/v1/session-token', sessionToken);

// Apply authMiddleware to all routes after this point
app.use('*', authMiddleware);

// Apply rateLimiter to all authenticated routes (after authMiddleware)
app.use('*', rateLimiter({ windowMs: 60 * 1000, max: 100 }));

// Routes that require authentication
app.route('/sessions', sessions);
app.route('/voice', voice);
app.route('/v1/learning-notes', learningNotes);

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

serve({
  fetch: (request) => app.fetch(request, bindings),
  port: 3001
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
});

export default app;
