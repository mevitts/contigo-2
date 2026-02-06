import { appConfig } from './config';
import type {
  ApiErrorShape,
  CreateSessionRequest,
  SessionRecord,
  SessionSummaryDetails,
  SpanishSnippet,
  UserProfile,
  VoiceWebsocketInfo,
} from './types';

export class ContigoApiError extends Error {
  status: number;
  payload: ApiErrorShape | undefined;

  constructor(message: string, status: number, payload?: ApiErrorShape) {
    super(message);
    this.name = 'ContigoApiError';
    this.status = status;
    this.payload = payload;
  }
}

interface JsonRequestInit extends RequestInit {
  query?: Record<string, string | number | boolean | null | undefined>;
}

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

function readEnvValue(key: string): string | undefined {
  try {
    const env = (import.meta as any)?.env as Record<string, string | undefined> | undefined;
    if (env) {
      const direct = env[key];
      if (typeof direct === 'string' && direct.trim()) {
        return direct;
      }
      const prefixed = env[`VITE_${key}`];
      if (typeof prefixed === 'string' && prefixed.trim()) {
        return prefixed;
      }
    }
  } catch (_error) {
    // Not running in a bundler environment; fall through to other sources
  }

  try {
    if (typeof process !== 'undefined' && process?.env) {
      const direct = process.env[key] || process.env[`VITE_${key}`];
      if (direct && direct.trim()) {
        return direct;
      }
    }
  } catch (_error) {
    // ignore - process may be unavailable in browser
  }

  return undefined;
}

function ensureTrailingSlash(input: string): string {
  return input.endsWith('/') ? input : `${input}/`;
}

let baseLogCount = 0;

function buildUrl(path: string, query?: JsonRequestInit['query']): URL {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const overrideBase = readEnvValue('CONTIGO_API_BASE_URL');
  const baseUrl = ensureTrailingSlash(overrideBase || appConfig.apiBaseUrl);
  if (import.meta.env.DEV && baseLogCount < 5) {
    baseLogCount += 1;
    console.log('[api] base →', baseUrl);
  }
  const url = new URL(normalizedPath, baseUrl);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }

  return url;
}

async function parseError(response: Response): Promise<ApiErrorShape | undefined> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }
  try {
    const data = (await response.json()) as ApiErrorShape;
    return data;
  } catch (_error) {
    return undefined;
  }
}


async function apiRequest<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
  const { query, headers, body, ...rest } = init;
  const url = buildUrl(path, query);
  const fetchInit: RequestInit = {
    ...rest,
    headers: {
      ...JSON_HEADERS,
      ...(headers ?? {}),
    },
    body,
  };

  if (import.meta.env.DEV) {
    console.log('[api] request', { url: url.toString(), method: fetchInit.method ?? 'GET' });
  }

  const response = await fetch(url, fetchInit);
  if (!response.ok) {
    const payload = await parseError(response);
    const message = payload?.message || payload?.error || response.statusText;
    throw new ContigoApiError(message, response.status, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json()) as T;
  return data;
}

function normalizeSession(input: any): SessionRecord {
  const record = input?.session ?? input;
  const id = record?.id ?? record?.sessionId ?? '';
  const createdAt = record?.created_at ?? record?.createdAt ?? new Date().toISOString();
  const updatedAt = record?.updated_at ?? record?.updatedAt ?? null;
  const adaptiveRaw = record?.adaptive;
  let adaptive: boolean | null = null;
  if (typeof adaptiveRaw === 'boolean') {
    adaptive = adaptiveRaw;
  } else if (typeof adaptiveRaw === 'string') {
    adaptive = ['true', '1', 'yes'].includes(adaptiveRaw.toLowerCase());
  }

  return {
    id,
    userId: record?.user_id ?? record?.userId ?? '',
    language: record?.language ?? 'es',
    topic: record?.topic ?? null,
    agentDisplayName: record?.agent_display_name ?? record?.agentDisplayName ?? null,
    difficulty: record?.difficulty ?? null,
    adaptive,
    createdAt,
    updatedAt,
  };
}

export async function authenticateDemoUser(code = appConfig.demoAuthCode): Promise<UserProfile> {
  try {
    const data = await apiRequest<any>('/auth/callback', {
      method: 'GET',
      query: { code },
    });

    const user = data?.user ?? {};
    return {
      id: user.id ?? 'aaaaaaaa-0000-4000-8000-000000000001',
      email: user.email,
      firstName: user.first_name ?? user.firstName,
      lastName: user.last_name ?? user.lastName,
      organizationId: user.organization_id ?? user.organizationId,
      connectionType: user.connection_type ?? user.connectionType,
      demoMode: Boolean(data?.demo_mode ?? true),
      membershipTier: (user.membership_tier ?? user.membershipTier ?? data?.membership_tier ?? data?.membershipTier ?? 'free') as 'free' | 'premium' | 'demo',
      maxConversationMinutes: typeof data?.max_conversation_minutes === 'number' ? data.max_conversation_minutes : undefined,
    };
  } catch (err) {
    // If the auth callback isn't available locally (404) or the API isn't running,
    // fall back to a local demo user so the frontend can continue to the dashboard.
    if (err instanceof ContigoApiError && err.status === 404) {
      return {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        email: 'demo@contigo.app',
        firstName: 'Demo',
        lastName: 'User',
        organizationId: undefined,
        connectionType: 'demo',
        demoMode: true,
        membershipTier: 'demo',
        maxConversationMinutes: 3,
      };
    }

    // Re-throw other errors so they surface during debugging
    throw err;
  }
}

export async function listSessions(userId: string, signal?: AbortSignal): Promise<SessionRecord[]> {
  if (!userId) {
    return [];
  }

  const data = await apiRequest<any>('/sessions', {
    method: 'GET',
    signal,
    query: { userId },
  });

  const sessions: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
  return sessions.map(normalizeSession);
}

export async function createSession(params: CreateSessionRequest): Promise<SessionRecord> {
  const data = await apiRequest<any>('/sessions', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  return normalizeSession(data);
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (!sessionId) {
    return;
  }

  await apiRequest(`/sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

export async function getVoiceWebsocketUrl(options: {
  sessionId: string;
  userId: string;
  difficulty?: string;
  adaptive?: boolean;
  extraSupport?: boolean;
}): Promise<VoiceWebsocketInfo> {
  const { sessionId, userId, difficulty, adaptive, extraSupport } = options;

  const data = await apiRequest<any>('/voice/websocket-url', {
    method: 'GET',
    query: {
      sessionId,
      userId,
      difficulty,
      adaptive,
      extraSupport,
    },
  });

  return {
    websocketUrl: data?.websocketUrl ?? '',
    sessionId: data?.sessionId ?? sessionId,
    userId: data?.userId ?? userId,
    difficulty: data?.difficulty ?? difficulty ?? null,
    adaptive: typeof data?.adaptive === 'boolean' ? data.adaptive : adaptive,
  };
}

export async function completeSession(
  sessionId: string,
  payload: {
    endTime?: string;
    difficulty?: string | null;
    adaptive?: boolean;
    topic?: string | null;
  } = {}
): Promise<SessionRecord> {
  const data = await apiRequest<any>(`/sessions/${sessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return normalizeSession(data);
}

export async function getVoiceServiceHealth(signal?: AbortSignal): Promise<any> {
  return apiRequest('/voice/health', {
    method: 'GET',
    signal,
  });
}

export async function translateText(text: string, targetLanguage = 'en'): Promise<string> {
  const trimmed = text?.trim();
  if (!trimmed) {
    return '';
  }

  // Call local translation service directly (not through core-api)
  const translationUrl = `${appConfig.translationServiceUrl}/translate`;
  console.log('[api] translation request', { url: translationUrl });

  const response = await fetch(translationUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ text: trimmed, target_language: targetLanguage }),
  });

  if (!response.ok) {
    console.error('[api] translation failed', { status: response.status });
    return trimmed; // Fall back to original text
  }

  const data = await response.json();
  return data?.translation ?? trimmed;
}

export async function getSessionSummary(conversationId: string): Promise<SessionSummaryDetails | null> {
  if (!conversationId) {
    return null;
  }

  try {
    const data = await apiRequest<any>(`/voice/conversations/${conversationId}/summary`, {
      method: 'GET',
    });

    const highlights = data?.highlights ?? {};
    const localized = data?.localized_summary;
    return {
      conversationId: data?.conversation_id ?? conversationId,
      createdAt: data?.created_at ?? new Date().toISOString(),
      summary: data?.summary ?? '',
      episodicSummary: data?.episodic_summary ?? null,
      localizedSummary:
        localized && localized.text
          ? {
              text: localized.text,
              language: localized.language ?? 'es',
            }
          : null,
      highlights: {
        topics: Array.isArray(highlights?.topics) ? highlights.topics : [],
        notableMoments: Array.isArray(highlights?.notable_moments) ? highlights.notable_moments : [],
        learningFocus: Array.isArray(highlights?.learning_focus) ? highlights.learning_focus : [],
        personalConnections: Array.isArray(highlights?.personal_connections)
          ? highlights.personal_connections
          : [],
        spanishSnippets: Array.isArray(highlights?.spanish_snippets)
          ? (highlights.spanish_snippets as Array<Partial<SpanishSnippet>>)
              .map((entry) => ({
                spanish: entry?.spanish ?? "",
                english: entry?.english ?? "",
                context: entry?.context ?? "",
              }))
              .filter((entry) => entry.spanish.trim().length > 0)
          : [],
        errorInsights: Array.isArray(highlights?.error_insights) ? highlights.error_insights : [],
      },
    };
  } catch (error) {
    if (error instanceof ContigoApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
