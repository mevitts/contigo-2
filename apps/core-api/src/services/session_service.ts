import { query } from '../db/db_service.js'; // Assuming DbEnv contains VULTR_DB_CONNECTION_STRING
import type { DbEnv } from '../db/db_service.js';
import type { AppEnv } from './auth_service.js';

interface SessionRow {
  id: string;
  user_id: string;
  agent_display_name: string | null;
  language: string | null;
  difficulty: string | null;
  adaptive: boolean | null;
  topic: string | null;
  start_time: string;
  end_time: string | null;
}

// Map the raw database row to a more user-friendly format
export function mapSessionRow(row: SessionRow) {
  const adaptiveFlag = typeof row.adaptive === 'boolean'
    ? row.adaptive
    : row.adaptive === null || row.adaptive === undefined
      ? null
      : String(row.adaptive).toLowerCase() === 'true';

  return {
    id: row.id,
    user_id: row.user_id,
    agent_display_name: row.agent_display_name ?? 'Contigo Coach',
    language: row.language ?? 'es',
    topic: row.topic ?? null,
    difficulty: row.difficulty ?? null,
    adaptive: adaptiveFlag ?? false,
    created_at: row.start_time,
    updated_at: row.end_time,
  };
}

export function placeholderEmail(userId: string): string {
  return `voice+${userId}@contigo.local`;
}

export function placeholderWorkosId(userId: string): string {
  return `demo-workos-${userId}`;
}

export async function ensureUserExists(env: DbEnv, userId: string): Promise<void> {
  const email = placeholderEmail(userId);
  const workosId = placeholderWorkosId(userId);

  await query(
    env,
    `INSERT INTO users (id, email, workos_id)
     VALUES ($1::uuid, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       workos_id = COALESCE(users.workos_id, EXCLUDED.workos_id)`,
    [userId, email, workosId]
  );
}
