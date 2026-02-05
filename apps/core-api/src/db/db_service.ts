import pg from 'pg';
import type { QueryResult, QueryResultRow, PoolClient, Pool as PoolType } from 'pg';
import type { AppEnv, DbEnv } from '../services/auth_service.js';

const { Pool } = pg;

// A simple in-memory cache for the DB pool to avoid recreating it on every request
let dbPool: PoolType | undefined;

function getDbPool(env: DbEnv): PoolType {
  if (!env.VULTR_DB_CONNECTION_STRING) {
    throw new Error('VULTR_DB_CONNECTION_STRING is not defined in the environment.');
  }
  if (!dbPool) {
    dbPool = new Pool({
      connectionString: env.VULTR_DB_CONNECTION_STRING,
      // You might want to add SSL options here for production
      // ssl: {
      //   rejectUnauthorized: false // Adjust as needed for your specific SSL setup
      // }
    });
    // Add an error listener to the pool
    dbPool.on('error', (err: Error) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1); // Exit process to allow container orchestrator to restart
    });
    console.log('Database pool created.');
  }
  return dbPool;
}

/**
 * Executes a SQL query against the PostgreSQL database.
 * @param env The environment object containing the database connection string.
 * @param sql The SQL query string.
 * @param params Optional array of query parameters.
 * @returns A promise that resolves to the query result rows.
 */
export async function query<T extends QueryResultRow>(env: DbEnv, sql: string, params?: any[]): Promise<T[]> {
  const pool = getDbPool(env);
  const client = await pool.connect();
  try {
    const result: QueryResult<T> = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Executes multiple queries within a database transaction.
 * Automatically commits on success, rolls back on error.
 *
 * @param env - Database environment with connection string
 * @param callback - Function that receives a client and performs queries
 * @returns The result of the callback function
 */
export async function withTransaction<T>(
  env: DbEnv,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getDbPool(env);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type { DbEnv };
