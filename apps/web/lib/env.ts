const runtimeEnv: Record<string, string | undefined> = {
  MODE: import.meta.env.MODE,
  BASE_URL: import.meta.env.BASE_URL,
  PROD: String(import.meta.env.PROD),
  DEV: String(import.meta.env.DEV),
  SSR: String(import.meta.env.SSR),
  VITE_CORE_API_URL: import.meta.env.VITE_CORE_API_URL,
  VITE_VOICE_ENGINE_WS: import.meta.env.VITE_VOICE_ENGINE_WS,
  VITE_CONTIGO_API_BASE_URL: import.meta.env.VITE_CONTIGO_API_BASE_URL,
  VITE_CONTIGO_DEMO_AUTH_CODE: import.meta.env.VITE_CONTIGO_DEMO_AUTH_CODE,
  VITE_CONTIGO_DEVELOPER_MODE: import.meta.env.VITE_CONTIGO_DEVELOPER_MODE,
  VITE_CONTIGO_DEV_USER_ID: import.meta.env.VITE_CONTIGO_DEV_USER_ID,
  VITE_CONTIGO_DEV_USER_EMAIL: import.meta.env.VITE_CONTIGO_DEV_USER_EMAIL,
  VITE_CONTIGO_DEV_USER_FIRST_NAME: import.meta.env.VITE_CONTIGO_DEV_USER_FIRST_NAME,
  VITE_CONTIGO_DEV_USER_LAST_NAME: import.meta.env.VITE_CONTIGO_DEV_USER_LAST_NAME,
  VITE_CONTIGO_DEV_USER_DEMO_MODE: import.meta.env.VITE_CONTIGO_DEV_USER_DEMO_MODE,
  VITE_CONTIGO_DEMO_SOS_LIMIT: import.meta.env.VITE_CONTIGO_DEMO_SOS_LIMIT,
};

export default runtimeEnv;
