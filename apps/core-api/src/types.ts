import type { DbEnv } from './services/auth_service.js';
import type { Config } from './config.js';

// Extend the Hono bindings to include our loaded Config and userId from auth
export type AppBindings = DbEnv & {
  config: Config;
  userId: string;
};
