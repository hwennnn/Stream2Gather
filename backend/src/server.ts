import cors, { CorsOptions } from "cors";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { createServer, Server } from "http";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import initApolloServer from "./apollo";
import { __prod__ } from "./constants";
import initializeDB from "./db/initializeDb";
import errorRouter from "./routes/404";
import router from "./routes/routes";
import sessionOptions from "./session/session";
import setUpIo from "./socket";

const corsOptions: CorsOptions = {
    origin: process.env.CORS_ORIGIN,
    credentials: true,
};

export class ApiServer {
    public httpServer: Server | null = null;
    public io: SocketServer | null = null;

    async initialize(port = process.env.PORT) {
        await initializeDB();

        const app = express();
        const redis = new Redis(process.env.REDIS_ADDRESS as string);

        app.set("trust proxy", !__prod__);
        app.use(
            helmet({
                crossOriginEmbedderPolicy: __prod__,
                contentSecurityPolicy: __prod__,
            })
        );
        app.use(cors(corsOptions));
        app.use(session(sessionOptions(redis)));
        app.use(router);

        const httpServer = createServer(app);
        httpServer.timeout = 1200000;

        await initApolloServer(app, httpServer, redis);

        const io = new SocketServer(httpServer, {
            cors: {
                origin: process.env.CORS_ORIGIN,
                methods: ["GET", "POST"],
            },
            pingTimeout: 60000,
        });
        setUpIo(io, redis);

        app.use(errorRouter);

        httpServer.listen(port, () => {
            if (!__prod__) {
                console.log(`Server listening on port ${port}...`);
            }
        });

        this.httpServer = httpServer;
        this.io = io;
    }

    async close(): Promise<void> {
        console.log("\nShutting down httpServer...");
        this.httpServer?.close();
        this.io?.close();
    }
}
