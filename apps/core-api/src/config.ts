import type { DbEnv } from './services/auth_service.js';
import { z } from 'zod';

// Define a schema for environment variables for validation
const EnvSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_APP_URL: z.string().url().default('http://localhost:5173'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  FORCE_DEMO_AUTH: z.enum(['true', 'false']).transform(val => val === 'true').default('false' as any),

  // Database
  VULTR_DB_CONNECTION_STRING: z.string().min(1, 'Database connection string is required'),

  // Voice Engine
  PYTHON_VOICE_SERVICE_URL: z.string().url().optional(),
  PYTHON_VOICE_SERVICE_PUBLIC_URL: z.string().url().optional(), // Browser-facing URL (defaults to localhost:8000)
  VOICE_ENGINE_SECRET: z.string().min(1, 'Voice engine secret is required'),

  // JWT authentication secret (falls back to VOICE_ENGINE_SECRET if not set)
  JWT_SECRET: z.string().min(16).optional(),

  // CORS - comma-separated list of allowed origins
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
});

// Define the shape of the configuration object
export type Config = z.infer<typeof EnvSchema>;

let config: Config | undefined;

/**
 * Loads and validates configuration from environment variables.
 * Caches the config object after the first load.
 */
export function loadConfig(env: DbEnv): Config {
  if (config) {
    return config;
  }

  const parsedEnv = EnvSchema.safeParse(env);

  if (!parsedEnv.success) {
    console.error('❌ Invalid environment variables:', parsedEnv.error.flatten());
    throw new Error('Invalid environment configuration');
  }

  config = parsedEnv.data;
  console.log('Configuration loaded. ENVIRONMENT:', config.ENVIRONMENT);
  return config;
}
