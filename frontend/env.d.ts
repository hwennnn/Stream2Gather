declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DISABLE_NEW_JSX_TRANSFORM: string;
      env: string;
      NEXT_PUBLIC_BASE_URL: string;
      SERVER_URL: string;
      COOKIE_NAME: string;
      APOLLO_SERVER_URL: string;
      FIREBASE_API_KEY: string;
      FIREBASE_AUTH_DOMAIN: string;
      FIREBASE_PROJECT_ID: string;
      FIREBASE_STORAGE_BUCKET: string;
      FIREBASE_MESSAGING_SENDER_ID: string;
      FIREBASE_APP_ID: string;
      FIREBASE_MEASUREMENT_ID: string;
    }
  }
}

export {}
