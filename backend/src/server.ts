import initApolloServer from '@src/apollo';
import { isProd } from '@src/constants/config';
import initializeDB from '@src/db/initializeDb';
import errorRouter from '@src/routes/404';
import authRouter from '@src/routes/authRouter';
import router from '@src/routes/routes';
import sessionOptions from '@src/session/session';
import setUpIo from '@src/socket';
import { initializeFirebase } from '@src/utils/initializeFirebase';
import cors, { CorsOptions } from 'cors';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { createServer, Server } from 'http';
import Redis from 'ioredis';
import { Server as SocketServer } from 'socket.io';

export const corsOptions: CorsOptions = {
  origin: process.env.CORS_ORIGIN,
  credentials: true
};

export class ApiServer {
  public httpServer: Server | null = null;
  public io: SocketServer | null = null;

  async initialize(port = process.env.PORT): Promise<void> {
    initializeFirebase();

    await initializeDB();

    const app = express();
    const redis = new Redis(process.env.REDIS_ADDRESS);

    app.set('trust proxy', !isProd);
    app.use(
      helmet({
        crossOriginEmbedderPolicy: isProd,
        contentSecurityPolicy: isProd
      })
    );
    app.use(cors(corsOptions));
    app.use(session(sessionOptions(redis)));
    app.use(router);
    app.use('/api/v1/auth', authRouter);

    const httpServer = createServer(app);
    httpServer.timeout = 1200000;

    await initApolloServer(app, httpServer, redis);

    const io = new SocketServer(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN,
        methods: ['GET', 'POST']
      },
      pingTimeout: 60000
    });
    await setUpIo(io, redis);

    app.use(errorRouter);

    httpServer.listen(port, () => {
      if (!isProd) {
        console.log(`Server listening on port ${port}...`);
      }
    });

    this.httpServer = httpServer;
    this.io = io;
  }

  async close(): Promise<void> {
    console.log('\nShutting down httpServer...');
    this.httpServer?.close();
    this.io?.close();
  }
}
