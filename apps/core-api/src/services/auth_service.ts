import { query } from '../db/db_service.js';
import * as jose from 'jose';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

// Hono's Context can provide `env` so this type will be passed through
export interface AppEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  ENVIRONMENT: string;
  FRONTEND_APP_URL?: string;
  FORCE_DEMO_AUTH?: string;
  PYTHON_VOICE_SERVICE_URL?: string;
  PYTHON_VOICE_SERVICE_PUBLIC_URL?: string;
}

// Extend AppEnv to ensure DB connection string is available
export interface DbEnv extends AppEnv {
  VULTR_DB_CONNECTION_STRING: string;
  VOICE_ENGINE_SECRET: string;
  REDIS_URL: string; // Add Redis URL
}


export const hasGoogleConfig = (env: AppEnv) => Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
);

export const DEMO_MODE_ENABLED = (env: AppEnv) => env.FORCE_DEMO_AUTH === 'true' || !hasGoogleConfig(env);

export function wantsJsonResponse(request: Request, url: URL): boolean {
  const format = (url.searchParams.get('format') || '').toLowerCase();
  if (format === 'json') {
    return true;
  }
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json');
}

export function sanitizeRedirectTarget(target: string | null | undefined, fallback?: string): string {
  const base = fallback || DEFAULT_FRONTEND_URL;
  if (!target) {
    return base;
  }
  try {
    const parsed = new URL(target);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (_err) {
    // ignored, fallback used below
  }
  return base;
}

export function buildRedirectUrl(base: string, params: Record<string, string | undefined | null>): string {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

interface GoogleTokens {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
}

interface GoogleUserProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export async function exchangeCodeForGoogleTokens(env: AppEnv, code: string): Promise<GoogleTokens> {
  const params = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: env.GOOGLE_REDIRECT_URI!,
    grant_type: 'authorization_code'
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token exchange failed: ${errorText}`);
  }

  return response.json() as Promise<GoogleTokens>;
}

export async function fetchGoogleUserProfile(accessToken: string): Promise<GoogleUserProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Google profile: ${errorText}`);
  }

  return response.json() as Promise<GoogleUserProfile>;
}

/**
 * Upserts a user record in the database.
 * Creates new user if not exists, or updates email if changed.
 *
 * @param env - Database environment with connection string
 * @param opts - User details (externalUserId from OAuth, optional email)
 * @returns The user ID (same as externalUserId)
 */
export async function upsertUser(
  env: DbEnv,
  opts: { externalUserId: string; email?: string | null }
): Promise<string> {
  const email = opts.email || `user+${opts.externalUserId}@contigo.local`;
  const workosId = `oauth-${opts.externalUserId}`;

  await query(
    env,
    `INSERT INTO users (id, email, workos_id)
     VALUES ($1::uuid, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email),
       workos_id = COALESCE(users.workos_id, EXCLUDED.workos_id)`,
    [opts.externalUserId, email, workosId]
  );

  return opts.externalUserId;
}

/**
 * Generates an HS256 JWT for authenticating a user to the API.
 */
export async function generateAuthToken(
  secret: string,
  userId: string,
  email?: string | null
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const builder = new jose.SignJWT({ email: email || undefined })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setSubject(userId)
    .setIssuer('urn:contigo:core-api')
    .setExpirationTime('7d');
  return builder.sign(key);
}
