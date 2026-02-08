import { Hono } from 'hono';
import { z } from 'zod';
import type { DbEnv } from '../services/auth_service.js';
import { query } from '../db/db_service.js';
import { v4 as uuidv4 } from 'uuid';

const references = new Hono<{ Bindings: DbEnv }>();

// Reference type enum
const ReferenceTypeEnum = z.enum([
  'SONG',
  'LYRICS',
  'ARTICLE',
  'VIDEO',
  'BOOK_EXCERPT',
  'CULTURAL',
  'OTHER'
]);

// Schema for creating a reference
const CreateReferenceSchema = z.object({
  user_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1),
  reference_type: ReferenceTypeEnum,
  url: z.string().optional().nullable(),
  content_text: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  is_pinned: z.boolean().optional().default(false),
  tags: z.array(z.string()).optional().nullable(),
  notes: z.string().optional().nullable(),
  detected_context: z.string().optional().nullable(),
  detection_method: z.enum(['auto', 'manual']).optional().nullable(),
});

// Schema for updating a reference
const UpdateReferenceSchema = z.object({
  title: z.string().min(1).optional(),
  reference_type: ReferenceTypeEnum.optional(),
  url: z.string().optional().nullable(),
  content_text: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  is_pinned: z.boolean().optional(),
  tags: z.array(z.string()).optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * POST /v1/references
 * Creates a new reference.
 */
references.post('/', async (c) => {
  try {
    const rawBody = await c.req.json();
    const validatedBody = CreateReferenceSchema.safeParse(rawBody);

    if (!validatedBody.success) {
      return c.json({
        error: 'Invalid payload',
        details: validatedBody.error.issues
      }, 400);
    }

    const {
      user_id,
      conversation_id,
      title,
      reference_type,
      url,
      content_text,
      source,
      is_pinned,
      tags,
      notes,
      detected_context,
      detection_method,
    } = validatedBody.data;

    const id = uuidv4();
    const created_at = new Date().toISOString();
    const tagsJson = tags ? JSON.stringify(tags) : null;

    await query(
      c.env,
      `INSERT INTO user_references (
         id,
         user_id,
         conversation_id,
         title,
         reference_type,
         url,
         content_text,
         source,
         is_pinned,
         tags,
         notes,
         detected_context,
         detection_method,
         created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz)`,
      [
        id,
        user_id,
        conversation_id || null,
        title,
        reference_type,
        url || null,
        content_text || null,
        source || null,
        is_pinned,
        tagsJson,
        notes || null,
        detected_context || null,
        detection_method || null,
        created_at,
      ]
    );

    return c.json({
      message: 'Reference created successfully',
      id,
      created_at,
    }, 201);

  } catch (error) {
    console.error('Error creating reference:', error);
    return c.json({
      error: 'Failed to create reference',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /v1/references
 * List user's references.
 * Query params: userId (required), conversationId (optional)
 */
references.get('/', async (c) => {
  try {
    const userId = c.req.query('userId');
    const conversationId = c.req.query('conversationId');

    if (!userId) {
      return c.json({ error: 'userId query parameter is required' }, 400);
    }

    let sql = `
      SELECT
        id,
        user_id,
        conversation_id,
        title,
        reference_type,
        url,
        content_text,
        source,
        is_pinned,
        tags,
        notes,
        detected_context,
        detection_method,
        created_at
      FROM user_references
      WHERE user_id = $1::uuid
    `;
    const params: (string | null)[] = [userId];

    if (conversationId) {
      sql += ` AND conversation_id = $2::uuid`;
      params.push(conversationId);
    }

    sql += ` ORDER BY is_pinned DESC, created_at DESC`;

    const result = await query(c.env, sql, params);

    // Parse tags JSON for each reference
    const references = result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      tags: row.tags ? JSON.parse(row.tags as string) : null,
    }));

    return c.json({ references }, 200);

  } catch (error) {
    console.error('Error listing references:', error);
    return c.json({
      error: 'Failed to list references',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /v1/references/pinned
 * Get user's pinned references (for agent context).
 * Query params: userId (required), limit (optional, default 5)
 */
references.get('/pinned', async (c) => {
  try {
    const userId = c.req.query('userId');
    const limit = parseInt(c.req.query('limit') || '5', 10);

    if (!userId) {
      return c.json({ error: 'userId query parameter is required' }, 400);
    }

    const result = await query(
      c.env,
      `SELECT
        id,
        user_id,
        title,
        reference_type,
        url,
        source,
        tags
      FROM user_references
      WHERE user_id = $1::uuid AND is_pinned = true
      ORDER BY created_at DESC
      LIMIT $2`,
      [userId, limit]
    );

    // Parse tags JSON for each reference
    const references = result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      tags: row.tags ? JSON.parse(row.tags as string) : null,
    }));

    return c.json({ references }, 200);

  } catch (error) {
    console.error('Error listing pinned references:', error);
    return c.json({
      error: 'Failed to list pinned references',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /v1/references/:id
 * Get a single reference by ID.
 */
references.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const result = await query(
      c.env,
      `SELECT
        id,
        user_id,
        conversation_id,
        title,
        reference_type,
        url,
        content_text,
        source,
        is_pinned,
        tags,
        notes,
        detected_context,
        detection_method,
        created_at
      FROM user_references
      WHERE id = $1::uuid`,
      [id]
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'Reference not found' }, 404);
    }

    const row = result.rows[0] as Record<string, unknown>;
    const reference = {
      ...row,
      tags: row.tags ? JSON.parse(row.tags as string) : null,
    };

    return c.json({ reference }, 200);

  } catch (error) {
    console.error('Error getting reference:', error);
    return c.json({
      error: 'Failed to get reference',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * PATCH /v1/references/:id
 * Update a reference (pin/unpin, edit).
 */
references.patch('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const rawBody = await c.req.json();
    const validatedBody = UpdateReferenceSchema.safeParse(rawBody);

    if (!validatedBody.success) {
      return c.json({
        error: 'Invalid payload',
        details: validatedBody.error.issues
      }, 400);
    }

    const updates = validatedBody.data;
    const setClauses: string[] = [];
    const params: (string | boolean | null)[] = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex}`);
      params.push(updates.title);
      paramIndex++;
    }

    if (updates.reference_type !== undefined) {
      setClauses.push(`reference_type = $${paramIndex}`);
      params.push(updates.reference_type);
      paramIndex++;
    }

    if (updates.url !== undefined) {
      setClauses.push(`url = $${paramIndex}`);
      params.push(updates.url);
      paramIndex++;
    }

    if (updates.content_text !== undefined) {
      setClauses.push(`content_text = $${paramIndex}`);
      params.push(updates.content_text);
      paramIndex++;
    }

    if (updates.source !== undefined) {
      setClauses.push(`source = $${paramIndex}`);
      params.push(updates.source);
      paramIndex++;
    }

    if (updates.is_pinned !== undefined) {
      setClauses.push(`is_pinned = $${paramIndex}`);
      params.push(updates.is_pinned);
      paramIndex++;
    }

    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex}`);
      params.push(updates.tags ? JSON.stringify(updates.tags) : null);
      paramIndex++;
    }

    if (updates.notes !== undefined) {
      setClauses.push(`notes = $${paramIndex}`);
      params.push(updates.notes);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    params.push(id);

    await query(
      c.env,
      `UPDATE user_references SET ${setClauses.join(', ')} WHERE id = $${paramIndex}::uuid`,
      params
    );

    return c.json({ message: 'Reference updated successfully' }, 200);

  } catch (error) {
    console.error('Error updating reference:', error);
    return c.json({
      error: 'Failed to update reference',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * DELETE /v1/references/:id
 * Delete a reference.
 */
references.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const result = await query(
      c.env,
      `DELETE FROM user_references WHERE id = $1::uuid RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'Reference not found' }, 404);
    }

    return c.json({ message: 'Reference deleted successfully' }, 200);

  } catch (error) {
    console.error('Error deleting reference:', error);
    return c.json({
      error: 'Failed to delete reference',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default references;
