import { query } from '../db/db_service.js';
import type { DbEnv } from '../db/db_service.js';

interface SessionVoiceMetadata {
  difficulty: string | null;
  adaptive: boolean | null;
}

export function hasDatabaseConnection(env: DbEnv): boolean {
  // Check for either VULTR_DB_CONNECTION_STRING from env or DATABASE_URL if that's also used
  return Boolean(env.VULTR_DB_CONNECTION_STRING);
}

export function parseAdaptiveFlag(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const lowered = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(lowered)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(lowered)) {
    return false;
  }
  return null;
}

export async function loadSessionMetadata(env: DbEnv, sessionId: string): Promise<SessionVoiceMetadata | null> {
  if (!hasDatabaseConnection(env)) {
    return null;
  }

  try {
    const rows = await query<SessionVoiceMetadata>(
      env,
      `SELECT difficulty, adaptive
       FROM conversations
       WHERE id = $1::uuid
       LIMIT 1`,
      [sessionId]
    );
    return rows[0] ?? null;
  } catch (error) {
    console.warn('Unable to load session metadata for voice connection:', error);
    return null;
  }
}
