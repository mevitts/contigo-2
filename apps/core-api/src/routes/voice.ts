import { Hono } from 'hono';
import { z } from 'zod';
import type { DbEnv } from '../services/auth_service.js';
import { loadSessionMetadata, parseAdaptiveFlag } from '../services/voice_service.js';

const voice = new Hono<{ Bindings: DbEnv }>();

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

  const { sessionId, userId } = validated.data;
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

  // Construct WebSocket URL for browser (using public URL, not Docker internal)
  const wsUrl = new URL('/voice/ws', publicVoiceUrl);
  wsUrl.protocol = wsUrl.protocol.replace('http', 'ws'); // http -> ws, https -> wss
  wsUrl.searchParams.set('user_id', userId);
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

  console.log('Voice WebSocket issued', {
    sessionId,
    userId,
    difficulty,
    adaptive: adaptiveFlag,
    extraSupport: extraSupportFlag,
    metadataLoaded: Boolean(metadata)
  });
  
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
      error: error instanceof Error ? error.message : 'Unknown error'
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

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      message: error instanceof Error ? error.message : 'Unknown error',
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
    const response = await fetch(targetUrl, {
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
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 502);
  }
});

export default voice;
