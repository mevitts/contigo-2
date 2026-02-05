/**
 * Application constants
 * Centralized location for magic strings and configuration values
 */

/**
 * Demo user credentials for local development
 * Only works when FORCE_DEMO_AUTH=true
 * Note: IDs must be valid UUIDs for PostgreSQL compatibility
 */
export const DEMO_USER = {
  ID: 'aaaaaaaa-0000-4000-8000-000000000001',
  EMAIL: 'demo@contigo.app',
  FIRST_NAME: 'Demo',
  LAST_NAME: 'User',
  /** Test credentials - only work in demo mode */
  TEST_EMAIL: 'test@contigo.app',
  TEST_PASSWORD: 'password',
} as const;

/**
 * Mock user for testing without full auth flow
 * Only works when FORCE_DEMO_AUTH=true
 */
export const MOCK_USER = {
  ID: 'bbbbbbbb-0000-4000-8000-000000000002',
  TOKEN: 'mock-user-token',
} as const;
