declare global {
    namespace NodeJS {
        interface ProcessEnv {
            PORT: string;
            CORS_ORIGIN: string;
            REDIS_ADDRESS: string;
            SESSION_SECRET: string;
        }
    }
}

export {};
