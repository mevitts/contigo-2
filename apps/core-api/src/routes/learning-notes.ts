import { Hono } from 'hono';
import { z } from 'zod';
import type { DbEnv } from '../services/auth_service.js';
import { query } from '../db/db_service.js';
import { v4 as uuidv4 } from 'uuid';

const learningNotes = new Hono<{ Bindings: DbEnv }>();

// Schema for validating the learning note payload
const LearningNoteSchema = z.object({
  conversation_id: z.string().uuid(),
  user_id: z.string().uuid(),
  note_type: z.string().min(1).max(50),
  priority: z.number().int().min(1).max(5).optional(), // 1 being highest priority
  error_category: z.string().min(1).max(100).optional(),
  user_text: z.string().min(1),
  agent_context: z.string().min(1).optional(),
  suggestion: z.string().min(1).optional(),
});

type LearningNotePayload = z.infer<typeof LearningNoteSchema>;

/**
 * POST /v1/learning-notes
 * Creates a new learning note.
 */
learningNotes.post('/', async (c) => {
  try {
    const rawBody = await c.req.json();
    const validatedBody = LearningNoteSchema.safeParse(rawBody);

    if (!validatedBody.success) {
      return c.json({ 
        error: 'Invalid payload', 
        details: validatedBody.error.issues
      }, 400);
    }

    const {
      conversation_id,
      user_id,
      note_type,
      priority,
      error_category,
      user_text,
      agent_context,
      suggestion,
    } = validatedBody.data;

    const note_id = uuidv4();
    const timestamp = new Date().toISOString();

    await query(
      c.env,
      `INSERT INTO learning_notes (
         note_id,
         conversation_id,
         user_id,
         timestamp,
         note_type,
         priority,
         error_category,
         user_text,
         agent_context,
         suggestion
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5, $6, $7, $8, $9, $10)`,
      [
        note_id,
        conversation_id,
        user_id,
        timestamp,
        note_type,
        priority ?? 3, // Default priority to 3 if not provided
        error_category,
        user_text,
        agent_context,
        suggestion,
      ]
    );

    // TODO: Optionally enqueue enrichment job here

    return c.json({ 
      message: 'Learning note created successfully', 
      note_id 
    }, 201);

  } catch (error) {
    console.error('Error creating learning note:', error);
    return c.json({
      error: 'Failed to create learning note',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default learningNotes;

