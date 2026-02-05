import { Hono } from 'hono';
import type { DbEnv } from '../services/auth_service.js';
import * as jose from 'jose';

const sessionToken = new Hono<{ Bindings: DbEnv }>();

// Placeholder for user credit verification (to be implemented)
async function verifyUserCredits(env: DbEnv, userId: string): Promise<boolean> {
  // TODO: Implement actual credit verification using DB or external service
  console.log(`Verifying credits for user: ${userId}`);
  // For now, always return true for demo purposes
  return true;
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
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default sessionToken;
