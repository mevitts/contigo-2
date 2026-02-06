import { Hono } from 'hono';
import type { DbEnv } from '../services/auth_service.js';
import { query } from '../db/db_service.js';
import * as jose from 'jose';

const sessionToken = new Hono<{ Bindings: DbEnv }>();

// Max sessions per user per rolling 24-hour window (configurable via env)
const MAX_DAILY_SESSIONS = parseInt(process.env.MAX_DAILY_SESSIONS || '50', 10);

/**
 * Verify user has remaining session credits.
 * Checks that the user exists and hasn't exceeded the daily session limit.
 */
async function verifyUserCredits(env: DbEnv, userId: string): Promise<boolean> {
  try {
    // 1. Check user exists
    const users = await query(env,
      `SELECT id FROM users WHERE id = $1::uuid LIMIT 1`,
      [userId],
    );
    if (users.length === 0) {
      return false;
    }

    // 2. Count sessions in last 24 hours
    const result = await query<{ count: string }>(env,
      `SELECT COUNT(*) as count FROM conversations
       WHERE user_id = $1::uuid AND start_time > NOW() - INTERVAL '24 hours'`,
      [userId],
    );
    const sessionCount = parseInt(result[0]?.count ?? '0', 10);
    return sessionCount < MAX_DAILY_SESSIONS;
  } catch (err) {
    console.error('Credit verification query failed:', err);
    // Fail-open for now so existing users aren't blocked by a DB blip.
    // Switch to fail-closed (return false) once the feature is battle-tested.
    return true;
  }
}

/**
 * POST /v1/session-token
 * Generates a signed JWT for the voice engine.
 * Requires user_id in the request body.
 */
sessionToken.post('/', async (c) => {
  try {
    const { user_id, session_id } = await c.req.json();

    if (!user_id) {
      return c.json({ error: 'user_id is required' }, 400);
    }
    
    // Verify user credits (placeholder)
    const hasCredits = await verifyUserCredits(c.env, user_id);
    if (!hasCredits) {
      return c.json({ error: 'Insufficient credits or user not found' }, 403);
    }

    if (!c.env.VOICE_ENGINE_SECRET) {
      return c.json({ error: 'VOICE_ENGINE_SECRET is not configured' }, 500);
    }

    const secret = new TextEncoder().encode(c.env.VOICE_ENGINE_SECRET);
    const alg = 'HS256';

    const jwt = await new jose.SignJWT({ 'urn:example:claim': true })
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .setSubject(user_id)
      .setIssuer('urn:contigo:core-api')
      .setAudience('urn:contigo:voice-engine')
      .setExpirationTime('2h') // Token valid for 2 hours
      .setJti(session_id) // Use session_id as JWT ID
      .sign(secret);

    return c.json({ token: jwt }, 200);

  } catch (error) {
    console.error('Error generating session token:', error);
    return c.json({
      error: 'Failed to generate session token',
    }, 500);
  }
});

export default sessionToken;
