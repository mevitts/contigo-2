import { Hono } from 'hono';
import { z } from 'zod';
import * as jose from 'jose';
import type { DbEnv } from '../services/auth_service.js';
import { loadSessionMetadata, parseAdaptiveFlag } from '../services/voice_service.js';

const voice = new Hono<{ Bindings: DbEnv; Variables: { userId: string } }>();

// Validation schemas
const WebsocketUrlQuerySchema = z.object({
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
  userId: z.string().uuid('userId must be a valid UUID'),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  adaptive: z.string().optional(),
  extraSupport: z.string().optional(), // "true" to pre-activate soft beginner mode
});

const ConversationIdParamSchema = z.object({
  conversationId: z.string().uuid('conversationId must be a valid UUID'),
});

/**
 * GET /voice/websocket-url
 * Returns the WebSocket URL for voice conversations
 * Frontend will connect directly to Python service for WebSocket
 */
voice.get('/websocket-url', async (c) => {
  const url = new URL(c.req.url);
  const validated = WebsocketUrlQuerySchema.safeParse({
    sessionId: url.searchParams.get('sessionId'),
    userId: url.searchParams.get('userId'),
    difficulty: url.searchParams.get('difficulty') || undefined,
    adaptive: url.searchParams.get('adaptive') || undefined,
    extraSupport: url.searchParams.get('extraSupport') || undefined,
  });

  if (!validated.success) {
    return c.json({
      error: 'Validation failed',
      details: validated.error.flatten()
    }, 400);
  }

  const { sessionId } = validated.data;
  // Always use the authenticated userId from the JWT token (set by authMiddleware),
  // NOT the query param, to prevent userId mismatches between session creation
  // and later API calls (e.g. summary proxy uses auth token userId).
  const userId = c.get('userId') || validated.data.userId;
  let difficulty = validated.data.difficulty || null;
  let adaptiveFlag = parseAdaptiveFlag(validated.data.adaptive || null);
  let metadata: { difficulty: string | null; adaptive: boolean | null; } | null = null;

  // Ensure PYTHON_VOICE_SERVICE_URL is present in env
  if (!c.env.PYTHON_VOICE_SERVICE_URL) {
    return c.json({
      error: 'PYTHON_VOICE_SERVICE_URL is not configured in the environment.'
    }, 500);
  }

  // Use public URL for browser WebSocket (defaults to localhost:8000 for local dev)
  const publicVoiceUrl = c.env.PYTHON_VOICE_SERVICE_PUBLIC_URL || 'http://localhost:8000';

  if (!difficulty || adaptiveFlag === null) {
    metadata = await loadSessionMetadata(c.env, sessionId);
    if (!difficulty && metadata?.difficulty) {
      difficulty = metadata.difficulty as 'beginner' | 'intermediate' | 'advanced';
    }
    if (adaptiveFlag === null && typeof metadata?.adaptive === 'boolean') {
      adaptiveFlag = metadata.adaptive;
    }
  }

  // Generate a signed JWT for voice-engine WebSocket auth
  let wsToken = '';
  if (c.env.VOICE_ENGINE_SECRET) {
    const secret = new TextEncoder().encode(c.env.VOICE_ENGINE_SECRET);
    wsToken = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setSubject(userId)
      .setIssuer('urn:contigo:core-api')
      .setAudience('urn:contigo:voice-engine')
      .setExpirationTime('2h')
      .setJti(sessionId)
      .sign(secret);
  }

  // Construct WebSocket URL for browser (using public URL, not Docker internal)
  const wsUrl = new URL('/voice/ws', publicVoiceUrl);
  wsUrl.protocol = wsUrl.protocol.replace('http', 'ws'); // http -> ws, https -> wss
  wsUrl.searchParams.set('token', wsToken);
  wsUrl.searchParams.set('session_id', sessionId);
  
  if (difficulty) {
    wsUrl.searchParams.set('difficulty', difficulty);
  }
  
  if (adaptiveFlag !== null) {
    wsUrl.searchParams.set('adaptive', adaptiveFlag ? 'true' : 'false');
  }

  // Extra support mode (pre-activates soft beginner)
  const extraSupportFlag = validated.data.extraSupport === 'true';
  if (extraSupportFlag) {
    wsUrl.searchParams.set('extra_support', 'true');
  }

  return c.json({
    websocketUrl: wsUrl.toString(),
    sessionId,
    userId,
    difficulty: difficulty ?? null,
    adaptive: adaptiveFlag ?? false,
    service: 'python-voice-microservice'
  });
});

/**
 * GET /voice/health
 * Proxy health check to Python voice service
 */
voice.get('/health', async (c) => {
  try {
    // Ensure PYTHON_VOICE_SERVICE_URL is present in env
    if (!c.env.PYTHON_VOICE_SERVICE_URL) {
      return c.json({
        status: 'unhealthy',
        pythonService: 'not_configured',
        message: 'PYTHON_VOICE_SERVICE_URL is not configured in the environment.'
      }, 500);
    }

    const healthUrl = `${c.env.PYTHON_VOICE_SERVICE_URL}/health`;
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      return c.json({
        status: 'unhealthy',
        pythonService: 'unreachable',
        statusCode: response.status
      }, 503);
    }
    
    const data = await response.json();
    
    return c.json({
      status: 'healthy',
      pythonService: 'reachable',
      pythonHealth: data
    });
    
  } catch (error) {
    console.error('Voice service health check failed:', error);
    return c.json({
      status: 'unhealthy',
      pythonService: 'error',
    }, 503);
  }
});

/**
 * POST /voice/translate
 * Proxy translation requests to Python voice service for SOS helper
 */
voice.post('/translate', async (c) => {
  if (!c.env.PYTHON_VOICE_SERVICE_URL) {
    return c.json({
      error: 'PYTHON_VOICE_SERVICE_URL is not configured in the environment.'
    }, 500);
  }

  const targetUrl = `${c.env.PYTHON_VOICE_SERVICE_URL}/voice/translate`;

  try {
    const body = await c.req.json();

    // Generate a short-lived JWT for voice-engine service-to-service auth
    let authHeader: Record<string, string> = {};
    if (c.env.VOICE_ENGINE_SECRET) {
      const secret = new TextEncoder().encode(c.env.VOICE_ENGINE_SECRET);
      const svcToken = await new jose.SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setSubject(c.get('userId') || 'system')
        .setIssuer('urn:contigo:core-api')
        .setAudience('urn:contigo:voice-engine')
        .setExpirationTime('5m')
        .sign(secret);
      authHeader = { 'Authorization': `Bearer ${svcToken}` };
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(body),
      // 120s timeout - OPUS model download/load on first request can take 60+ seconds
      signal: AbortSignal.timeout(120000),
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return c.json(
        data && typeof data === 'object' ? data : { error: 'Translation failed' },
        response.status as 400 | 500 | 502 | 503,
      );
    }

    return c.json(data ?? {});
  } catch (error) {
    console.error('Error proxying translation request:', error);
    return c.json({
      error: 'Translation service unavailable',
    }, 502);
  }
});

/**
 * GET /voice/conversations/:conversationId/summary
 * Proxy to Python voice service to fetch the latest stored summary
 */
voice.get('/conversations/:conversationId/summary', async (c) => {
  const validated = ConversationIdParamSchema.safeParse({
    conversationId: c.req.param('conversationId'),
  });

  if (!validated.success) {
    return c.json({
      error: 'Validation failed',
      details: validated.error.flatten()
    }, 400);
  }

  const { conversationId } = validated.data;

  if (!c.env.PYTHON_VOICE_SERVICE_URL) {
    return c.json({
      error: 'PYTHON_VOICE_SERVICE_URL is not configured in the environment.'
    }, 500);
  }

  const targetUrl = `${c.env.PYTHON_VOICE_SERVICE_URL}/voice/conversations/${conversationId}/summary`;

  try {
    // Generate a short-lived JWT for voice-engine service-to-service auth
    const authenticatedUserId = c.get('userId');
    let svcHeaders: Record<string, string> = {};
    if (c.env.VOICE_ENGINE_SECRET) {
      const secret = new TextEncoder().encode(c.env.VOICE_ENGINE_SECRET);
      const svcToken = await new jose.SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setSubject(authenticatedUserId || 'system')
        .setIssuer('urn:contigo:core-api')
        .setAudience('urn:contigo:voice-engine')
        .setExpirationTime('5m')
        .sign(secret);
      svcHeaders = { 'Authorization': `Bearer ${svcToken}` };
    }

    console.log(`[summary-proxy] userId=${authenticatedUserId}, conversation=${conversationId}`);

    const response = await fetch(targetUrl, {
      headers: svcHeaders,
      signal: AbortSignal.timeout(8000),
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return c.json(
        data && typeof data === 'object' ? data : { error: 'Failed to fetch conversation summary from voice service' },
        response.status as 400 | 404 | 500 | 502 | 503,
      );
    }

    return c.json(data ?? {});
  } catch (error) {
    console.error('Error fetching conversation summary from voice service:', error);
    return c.json({
      error: 'Failed to fetch conversation summary',
    }, 502);
  }
});

export default voice;
