declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT: string;
      CORS_ORIGIN: string;
      REDIS_ADDRESS: string;
      SESSION_SECRET: string;
      PG_HOST: string;
      PG_PORT: string;
      PG_USER: string;
      PG_PASSWORD: string;
      PG_DB: string;
      FIREBASE_PROJECT_ID: string;
    }
  }
}

export {}
