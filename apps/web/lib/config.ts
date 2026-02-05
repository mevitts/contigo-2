import type { AppConfig } from './types';
import runtimeEnv from './env';

type EnvSnapshot = Record<string, string | undefined> | undefined;

let currentEnvSnapshot: EnvSnapshot = runtimeEnv;
const loggedResolutions = new Set<string>();

function logResolution(key: string, source: string, value?: string): void {
  const token = `${key}:${source}`;
  if (loggedResolutions.has(token)) {
    return;
  }
  loggedResolutions.add(token);
  console.log('[config] resolve', { key, source, value });
}

function setEnvSnapshot(env?: Record<string, string | undefined>): void {
  currentEnvSnapshot = env;
  const keys = env ? Object.keys(env) : [];
  console.log('[config] env snapshot applied', { keys, hasApiBase: Boolean(env?.VITE_CONTIGO_API_BASE_URL) });
}

function readFromImportMeta(key: string): string | undefined {
  if (!currentEnvSnapshot) {
    return undefined;
  }

  const keys = [key, `VITE_${key}`];
  for (const candidate of keys) {
    const value = currentEnvSnapshot[candidate];
    if (typeof value === 'string' && value.trim().length > 0) {
      logResolution(key, `importMeta:${candidate}`, value);
      return value;
    }
  }

  return undefined;
}

function readFromProcessEnv(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process?.env) {
      const candidates = [key, `VITE_${key}`];
      for (const name of candidates) {
        const value = (process.env as Record<string, string | undefined>)[name];
        if (value && value.trim().length > 0) {
          logResolution(key, `processEnv:${name}`, value);
          return value;
        }
      }
    }
  } catch (_error) {
    // ignore - running in browser where process is undefined
  }
  return undefined;
}

function readFromGlobal(key: string): string | undefined {
  if (typeof globalThis !== 'undefined' && key in globalThis) {
    const value = (globalThis as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      logResolution(key, 'globalThis', value);
      return value;
    }
  }
  const viteKey = `VITE_${key}`;
  if (typeof globalThis !== 'undefined' && viteKey in globalThis) {
    const value = (globalThis as Record<string, unknown>)[viteKey];
    if (typeof value === 'string' && value.trim().length > 0) {
      logResolution(key, 'globalThis:VITE', value);
      return value;
    }
  }
  return undefined;
}

function readFromLocalStorage(key: string): string | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const value = window.localStorage.getItem(key);
      if (value && value.trim().length > 0) {
        logResolution(key, 'localStorage', value);
        return value;
      }
    }
  } catch (_error) {
    // ignore - localStorage may be unavailable (SSR or privacy settings)
  }
  return undefined;
}

function guessApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:8787';
  }

  const origin = window.location.origin;
  if (/localhost:\d+$/i.test(origin)) {
    // Common dev server pattern (e.g. Vite on :5173) - default backend port is 8787
    return 'http://localhost:8787';
  }

  return origin;
}

function resolveSetting(key: string, fallback?: string): string {
  const candidates = [
    readFromImportMeta(key),
    readFromProcessEnv(key),
    readFromGlobal(key),
    readFromLocalStorage(key),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate.trim();
    }
  }

  const trimmedFallback = (fallback ?? '').trim();
  logResolution(key, 'fallback', trimmedFallback);
  return trimmedFallback;
}

function resolveBooleanSetting(key: string, fallback = false): boolean {
  const value = resolveSetting(key);
  if (!value) {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function buildAppConfig(): AppConfig {
  // Read from VITE_CORE_API_URL or fall back to CONTIGO_API_BASE_URL
  const coreApiUrl = resolveSetting('CORE_API_URL');
  const apiBaseUrl = coreApiUrl || resolveSetting('CONTIGO_API_BASE_URL', guessApiBaseUrl());
  // Local translation service URL (defaults to localhost:8001 for local OPUS model)
  const translationServiceUrl = resolveSetting('TRANSLATION_SERVICE_URL', 'http://localhost:8001');
  const defaultAgentId = resolveSetting('CONTIGO_AGENT_ID', 'demo-agent');
  const defaultAgentName = resolveSetting('CONTIGO_AGENT_NAME', 'Demo Agent');
  const defaultLanguage = resolveSetting('CONTIGO_DEFAULT_LANGUAGE', 'es');
  const demoAuthCode = resolveSetting('CONTIGO_DEMO_AUTH_CODE', 'DEMO_CODE_123');
  const developerMode = resolveBooleanSetting('CONTIGO_DEVELOPER_MODE', false);

  const devUserId = resolveSetting('CONTIGO_DEV_USER_ID');
  const devUserEmail = resolveSetting('CONTIGO_DEV_USER_EMAIL');
  const devUserFirstName = resolveSetting('CONTIGO_DEV_USER_FIRST_NAME');
  const devUserLastName = resolveSetting('CONTIGO_DEV_USER_LAST_NAME');
  const devUserDemoFlag = resolveBooleanSetting('CONTIGO_DEV_USER_DEMO_MODE', false);

  const devUserProfile = developerMode && devUserId
    ? {
        id: devUserId,
        email: devUserEmail || undefined,
        firstName: devUserFirstName || undefined,
        lastName: devUserLastName || undefined,
        demoMode: devUserDemoFlag,
        developerMode: true,
      }
    : null;

  return {
    apiBaseUrl,
    translationServiceUrl,
    defaultAgentId,
    defaultAgentName,
    defaultLanguage,
    demoAuthCode,
    developerMode,
    devUserProfile,
  };
}

export const appConfig: AppConfig = buildAppConfig();

function refreshAppConfig(): void {
  const next = buildAppConfig();
  Object.assign(appConfig, next);
}

export function initializeAppConfigFromEnv(env?: Record<string, string | undefined>): void {
  const resolvedEnv =
    env ??
    (typeof window !== 'undefined' ? (window as any).__VITE_ENV__ : undefined);

  if (!resolvedEnv) {
    console.warn('[config] no env snapshot available yet; staying on fallback');
    return;
  }

  setEnvSnapshot(resolvedEnv);
  refreshAppConfig();
  console.log('[config] appConfig snapshot', {
    apiBaseUrl: appConfig.apiBaseUrl,
    translationServiceUrl: appConfig.translationServiceUrl,
    developerMode: appConfig.developerMode,
    devUserProfile: appConfig.devUserProfile,
  });
}

export function updateAppConfig(partial: Partial<AppConfig>): void {
  Object.assign(appConfig, partial);
}
