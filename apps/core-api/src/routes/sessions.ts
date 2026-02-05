import { Hono } from 'hono';
import { z } from 'zod';
import type { DbEnv } from '../services/auth_service.js';
import { query, withTransaction } from '../db/db_service.js';
import { ensureUserExists, mapSessionRow } from '../services/session_service.js';

const sessions = new Hono<{ Bindings: DbEnv }>();

// Validation schemas
const CreateSessionSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  agentId: z.string().min(1, 'agentId is required'),
  agentName: z.string().min(1, 'agentName is required'),
  language: z.string().min(2).max(10),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  adaptive: z.union([z.boolean(), z.string()]).optional(),
  topic: z.string().optional(),
});

const CompleteSessionSchema = z.object({
  endTime: z.string().datetime().optional(),
  difficulty: z.string().nullable().optional(),
  adaptive: z.boolean().optional(),
  topic: z.string().nullable().optional(),
});

const UserIdQuerySchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
});

const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
});

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

interface LearningNoteRow {
  note_id: string;
  conversation_id: string;
  timestamp: string;
  note_type: string;
  priority: number;
  error_category: string;
  user_text: string;
  agent_context: string;
  suggestion: string;
}

/**
 * POST /sessions
 * Create a new conversation session
 */
sessions.post('/', async (c) => {
  try {
    const rawBody = await c.req.json();
    const validated = CreateSessionSchema.safeParse(rawBody);

    if (!validated.success) {
      return c.json({
        error: 'Validation failed',
        details: validated.error.flatten()
      }, 400);
    }

    const { userId, agentName, language, difficulty, adaptive, topic } = validated.data;

    await ensureUserExists(c.env, userId);

    const normalizedDifficulty = difficulty ?? null;
    const adaptiveForInsert = (() => {
      if (typeof adaptive === 'boolean') {
        return adaptive;
      }
      if (typeof adaptive === 'string') {
        return adaptive.toLowerCase() === 'true';
      }
      return false;
    })();
    const normalizedTopic = topic ?? null;

    const rows = await query<SessionRow>(
      c.env,
      `INSERT INTO conversations (
         user_id,
         agent_display_name,
         language,
         difficulty,
         adaptive,
         topic,
         start_time
       )
       VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW())
       RETURNING 
         id::text,
         user_id::text,
         agent_display_name,
         language,
         difficulty,
         adaptive,
         topic,
         start_time::text,
         end_time::text`,
      [
        userId,
        agentName,
        language,
        normalizedDifficulty,
        adaptiveForInsert,
        normalizedTopic,
      ]
    );

    const inserted = rows[0];
    if (!inserted) {
      throw new Error('Failed to create session');
    }

    console.log(`Created session ${inserted.id} for user ${userId}`);

    return c.json({
      session: mapSessionRow(inserted)
    }, 201);
    
  } catch (error) {
    console.error('Error creating session:', error);
    return c.json({
      error: 'Failed to create session',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /sessions
 * List sessions for a user
 */
sessions.get('/', async (c) => {
  try {
    const validated = UserIdQuerySchema.safeParse({ userId: c.req.query('userId') });

    if (!validated.success) {
      return c.json({
        error: 'Validation failed',
        details: validated.error.flatten()
      }, 400);
    }

    const { userId } = validated.data;

    const sessions = await query<SessionRow>(
      c.env,
      `SELECT 
        id::text,
        user_id::text,
        agent_display_name,
        language,
        difficulty,
        adaptive,
        topic,
        start_time::text,
        end_time::text
       FROM conversations
       WHERE user_id = $1::uuid
       ORDER BY start_time DESC
       LIMIT 50`,
      [userId]
    );

    const normalized = sessions.map(mapSessionRow);
    return c.json({ sessions: normalized });
    
  } catch (error) {
    console.error('Error listing sessions:', error);
    return c.json({
      error: 'Failed to list sessions',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /sessions/:id
 * Get a specific session with its learning notes
 */
sessions.get('/:sessionId', async (c) => {
  try {
    const validated = SessionIdParamSchema.safeParse({ sessionId: c.req.param('sessionId') });

    if (!validated.success) {
      return c.json({
        error: 'Validation failed',
        details: validated.error.flatten()
      }, 400);
    }

    const { sessionId } = validated.data;
    const sessionRows = await query<SessionRow>(
      c.env,
      `SELECT 
        id::text,
        user_id::text,
        agent_display_name,
        language,
        difficulty,
        adaptive,
        topic,
        start_time::text,
        end_time::text
       FROM conversations
       WHERE id = $1::uuid`,
      [sessionId]
    );
    
    const session = sessionRows[0];
    if (!session) {
      return c.json({
        error: 'Session not found'
      }, 404);
    }

    const learningNotes = await query<LearningNoteRow>(
      c.env,
      `SELECT
        note_id::text,
        conversation_id::text,
        timestamp::text,
        note_type,
        priority,
        error_category,
        user_text,
        agent_context,
        suggestion
       FROM learning_notes
       WHERE conversation_id = $1::uuid
       ORDER BY timestamp ASC`,
      [sessionId]
    );

    return c.json({ 
      session: mapSessionRow(session),
      learning_notes: learningNotes
    });
    
  } catch (error) {
    console.error('Error getting session:', error);
    return c.json({
      error: 'Failed to get session',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});
/**
 * POST /sessions/:id/complete
 * Complete a session
 */
sessions.post('/:sessionId/complete', async (c) => {
  try {
    const paramValidated = SessionIdParamSchema.safeParse({ sessionId: c.req.param('sessionId') });

    if (!paramValidated.success) {
      return c.json({
        error: 'Validation failed',
        details: paramValidated.error.flatten()
      }, 400);
    }

    const { sessionId } = paramValidated.data;

    let rawPayload = {};
    try {
      rawPayload = await c.req.json();
    } catch (_err) {
      rawPayload = {};
    }

    const bodyValidated = CompleteSessionSchema.safeParse(rawPayload);
    if (!bodyValidated.success) {
      return c.json({
        error: 'Validation failed',
        details: bodyValidated.error.flatten()
      }, 400);
    }

    const payload = bodyValidated.data;
    const endTimeInput = payload.endTime ? new Date(payload.endTime) : new Date();
    if (Number.isNaN(endTimeInput.getTime())) {
      return c.json({
        error: 'Invalid endTime provided'
      }, 400);
    }

    const isoEndTime = endTimeInput.toISOString();
    const difficultyUpdate = payload.difficulty ?? null;
    const adaptiveUpdate = typeof payload.adaptive === 'boolean' ? payload.adaptive : null;
    const topicUpdate = payload.topic ?? null;

    const rows = await query<SessionRow>(
      c.env,
      `UPDATE conversations
         SET end_time = $2::timestamptz,
             difficulty = COALESCE($3, difficulty),
             adaptive = COALESCE($4::boolean, adaptive),
             topic = COALESCE($5, topic)
       WHERE id = $1::uuid
       RETURNING 
         id::text,
         user_id::text,
         agent_display_name,
         language,
         difficulty,
         adaptive,
         topic,
         start_time::text,
         end_time::text`,
      [sessionId, isoEndTime, difficultyUpdate, adaptiveUpdate, topicUpdate]
    );

    const updated = rows[0];
    if (!updated) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({ session: mapSessionRow(updated) });
  } catch (error) {
    console.error('Error completing session:', error);
    return c.json({
      error: 'Failed to complete session',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * DELETE /sessions/:id
 * Delete a session
 */
sessions.delete('/:sessionId', async (c) => {
  try {
    const validated = SessionIdParamSchema.safeParse({ sessionId: c.req.param('sessionId') });

    if (!validated.success) {
      return c.json({
        error: 'Validation failed',
        details: validated.error.flatten()
      }, 400);
    }

    const { sessionId } = validated.data;

    // Use transaction to ensure all deletes succeed or none do
    await withTransaction(c.env, async (client) => {
      await client.query(
        `DELETE FROM session_summaries WHERE conversation_id = $1::uuid`,
        [sessionId]
      );
      await client.query(
        `DELETE FROM learning_notes WHERE conversation_id = $1::uuid`,
        [sessionId]
      );
      await client.query(
        `DELETE FROM conversations WHERE id = $1::uuid`,
        [sessionId]
      );
    });

    console.log(`Deleted session ${sessionId}`);
    
    return c.json({
      message: 'Session deleted successfully',
      sessionId
    });
    
  } catch (error) {
    console.error('Error deleting session:', error);
    return c.json({
      error: 'Failed to delete session',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default sessions;
