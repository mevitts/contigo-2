import { Hono } from 'hono';
import { DEMO_MODE_ENABLED, hasGoogleConfig, sanitizeRedirectTarget, buildRedirectUrl, wantsJsonResponse, exchangeCodeForGoogleTokens, fetchGoogleUserProfile, upsertUser, generateAuthToken } from '../services/auth_service.js';
import type { AppEnv, DbEnv } from '../services/auth_service.js';
import { DEMO_USER } from '../constants.js';
import type { Config } from '../config.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

type AuthEnv = { Bindings: DbEnv; Variables: { config: Config } };

function getJwtSecret(config: Config, env: DbEnv): string | undefined {
  return config.JWT_SECRET || env.VOICE_ENGINE_SECRET || undefined;
}

const auth = new Hono<AuthEnv>();

/**
 * POST /auth/login
 * Handles email/password login.
 * NOTE: Test credentials only work when FORCE_DEMO_AUTH=true (development mode)
 */
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  const config = c.var.config;

  // Test credentials only work in demo mode (FORCE_DEMO_AUTH=true)
  if (config?.FORCE_DEMO_AUTH && email === DEMO_USER.TEST_EMAIL && password === DEMO_USER.TEST_PASSWORD) {
    const user = {
      id: DEMO_USER.ID,
      email: DEMO_USER.TEST_EMAIL,
      first_name: 'Test',
      last_name: 'User',
    };
    return c.json({
      auth: 'success',
      user,
    });
  }

  return c.json({
    auth: 'error',
    message: 'Invalid credentials',
  }, 401);
});

/**
 * GET /auth/login
 * Initiates OAuth flow with Google (or demo mode)
 */
auth.get('/login', async (c) => {
  const url = new URL(c.req.url);
  const redirectTarget = sanitizeRedirectTarget(
    url.searchParams.get('redirect'),
    c.env.FRONTEND_APP_URL || 'http://localhost:5173',
    c.env.FRONTEND_APP_URL,
  );
  const provider = 'google';
  
  // Demo mode for development
  if (DEMO_MODE_ENABLED(c.env)) {
    console.log('DEMO MODE: issuing automatic login redirect');
    const demoUser = {
      id: DEMO_USER.ID,
      email: DEMO_USER.EMAIL,
      first_name: DEMO_USER.FIRST_NAME,
      last_name: DEMO_USER.LAST_NAME
    };

    let databaseUserId: string | null = null;
    try {
      databaseUserId = await upsertUser(c.env, {
        externalUserId: demoUser.id,
        email: demoUser.email
      });
    } catch (err) {
      console.warn('Failed to persist demo user record:', err);
    }

    const userId = databaseUserId || demoUser.id;
    let token: string | undefined;
    const secret = getJwtSecret(c.var.config, c.env);
    if (secret) {
      token = await generateAuthToken(secret, userId, demoUser.email);
    }

    const destination = buildRedirectUrl(redirectTarget, {
      auth: 'success',
      demo_mode: '1',
      user_id: userId,
      email: demoUser.email,
      first_name: demoUser.first_name,
      last_name: demoUser.last_name,
      provider,
      token,
    });

    return c.redirect(destination, 302);
  }
  
  if (!hasGoogleConfig(c.env)) {
    console.error('Google OAuth configuration missing and demo mode disabled.');
    return c.json({
      error: 'Google OAuth is not configured',
      message: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI or enable demo mode.'
    }, 500);
  }

  console.log('User initiating Google login flow');
  const authorizationUrl = new URL(GOOGLE_AUTH_URL); // Defined in auth_service
  authorizationUrl.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID!);
  authorizationUrl.searchParams.set('redirect_uri', c.env.GOOGLE_REDIRECT_URI!);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', encodeURIComponent(redirectTarget));
  authorizationUrl.searchParams.set('access_type', 'offline');
  authorizationUrl.searchParams.set('prompt', 'consent');

  return c.redirect(authorizationUrl.toString(), 302);
});

/**
 * GET /auth/callback
 * Handles OAuth callback from Google
 */
auth.get('/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const wantsJson = wantsJsonResponse(c.req.raw, url); // c.req.raw is the underlying Request object
  const redirectTarget = sanitizeRedirectTarget(
    state ? decodeURIComponent(state) : undefined,
    c.env.FRONTEND_APP_URL || 'http://localhost:5173',
    c.env.FRONTEND_APP_URL,
  );
  
  if (!code) {
    const errorPayload = { error: 'Missing authorization code' };
    if (wantsJson) {
      return c.json(errorPayload, 400);
    }
    const destination = buildRedirectUrl(redirectTarget, {
      auth: 'error',
      message: 'missing_code'
    });
    return c.redirect(destination, 302);
  }
  
  // Demo mode
  if (DEMO_MODE_ENABLED(c.env)) {
    console.log('DEMO MODE: Returning mock user profile');
    const user = {
      id: DEMO_USER.ID,
      email: DEMO_USER.EMAIL,
      first_name: DEMO_USER.FIRST_NAME,
      last_name: DEMO_USER.LAST_NAME,
      provider: 'demo'
    };

    let userId: string | null = null;
    try {
      userId = await upsertUser(c.env, {
        externalUserId: user.id,
        email: user.email
      });
    } catch (err) {
      console.warn('Failed to persist demo user to DB:', err);
    }

    const resolvedUserId = userId || user.id;
    let token: string | undefined;
    const secret = getJwtSecret(c.var.config, c.env);
    if (secret) {
      token = await generateAuthToken(secret, resolvedUserId, user.email);
    }

    const payload = {
      demo_mode: true,
      message: 'Using demo authentication - Google OAuth not configured',
      user,
      user_id: resolvedUserId,
      token,
    };

    if (wantsJson) {
      return c.json(payload);
    }

    const destination = buildRedirectUrl(redirectTarget, {
      auth: 'success',
      demo_mode: '1',
      user_id: resolvedUserId,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      provider: user.provider,
      token,
    });
    return c.redirect(destination, 302);
  }
  
  if (!hasGoogleConfig(c.env)) {
    const errorPayload = { error: 'Google OAuth not configured' };
    if (wantsJson) {
      return c.json(errorPayload, 500);
    }
    const destination = buildRedirectUrl(redirectTarget, {
      auth: 'error',
      message: 'google_not_configured'
    });
    return c.redirect(destination, 302);
  }

  console.log(`Google auth callback received with code: ${code.substring(0, 10)}...`);

  try {
    const tokens = await exchangeCodeForGoogleTokens(c.env, code);
    if (!tokens.access_token) {
      throw new Error('Google response missing access token');
    }

    const profile = await fetchGoogleUserProfile(tokens.access_token);
    if (!profile?.sub) {
      throw new Error('Google profile missing subject identifier');
    }

    let userId: string | null = null;
    try {
      userId = await upsertUser(c.env, {
        externalUserId: profile.sub,
        email: profile.email,
      });
    } catch (err) {
      console.warn('Failed to persist authenticated user to DB:', err);
    }

    const resolvedUserId = userId || profile.sub;
    let token: string | undefined;
    const secret = getJwtSecret(c.var.config, c.env);
    if (secret) {
      token = await generateAuthToken(secret, resolvedUserId, profile.email);
    }

    const payload = {
      demo_mode: false,
      user: {
        id: profile.sub,
        email: profile.email,
        first_name: profile.given_name,
        last_name: profile.family_name,
        email_verified: profile.email_verified,
        profile_picture_url: profile.picture,
      },
      user_id: resolvedUserId,
      token,
    };

    if (wantsJson) {
      return c.json(payload);
    }

    const destination = buildRedirectUrl(redirectTarget, {
      auth: 'success',
      demo_mode: '0',
      user_id: resolvedUserId,
      email: profile.email || undefined,
      first_name: profile.given_name || undefined,
      last_name: profile.family_name || undefined,
      picture: profile.picture || undefined,
      provider: 'google',
      token,
    });

    return c.redirect(destination, 302);
  } catch (error) {
    console.error('Google authentication error:', error);
    if (wantsJson) {
      return c.json({
        error: 'Authentication failed',
      }, 401);
    }
    const destination = buildRedirectUrl(redirectTarget, {
      auth: 'error',
      message: 'auth_failed'
    });
    return c.redirect(destination, 302);
  }
});

export default auth;
