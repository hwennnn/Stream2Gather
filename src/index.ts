import "reflect-metadata";

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { json } from 'body-parser';
import connectRedis from "connect-redis";
import cors from 'cors';
import "dotenv-safe/config";
import express, { Request, Response } from 'express';
import session from "express-session";
import { createServer } from "http";
import Redis from 'ioredis';
import { buildSchema } from 'type-graphql';
import { COOKIE_NAME, __prod__ } from "./constants";
import { AppDataSource } from './data-source';
import CustomSocket from "./models/custom_socket";
import { HelloResolver } from './resolvers/hello';
import { MyContext } from "./types";


const main = async () => {
    await AppDataSource.initialize();

    const app = express();
    const RedisStore = connectRedis(session);
    const httpServer = createServer(app);

    const redis = new Redis(process.env.REDIS_ADDRESS as string);
    const socket = new CustomSocket(httpServer, redis);

    app.set("trust proxy", 1);
    app.use(
        cors({
            origin: process.env.CORS_ORIGIN,
            credentials: true,
        })
    );
    app.use(
        session({
            name: COOKIE_NAME,
            store: new RedisStore({
                client: redis as any,
                disableTouch: true,
            }),
            cookie: {
                maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
                httpOnly: true,
                sameSite: "lax", // csrf
                secure: __prod__, // cookie only works in https
                domain: __prod__ ? ".cloudrun.com" : undefined,
            },
            saveUninitialized: false,
            secret: process.env.SESSION_SECRET as string,
            resave: false,
        })
    );

    app.get("/health", (req: Request, res: Response) => {
        res.send("ok");
    });

    // Setup Apollo Server with GraphQL
    const apolloServer = new ApolloServer<MyContext>({
        schema: await buildSchema({
            resolvers: [HelloResolver],
            validate: false,
        }),
        plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    });

    await apolloServer.start();

    app.use(
        '/graphql',
        cors<cors.CorsRequest>(),
        json(),
        expressMiddleware(apolloServer, {
            context: async ({ req, res }) => ({ req, res, redis }),

        }),
    );

    //The 404 Route (ALWAYS Keep this as the last route)
    app.use('*', function (req: Request, res: Response) {
        res.sendStatus(404);
    });

    httpServer.listen(process.env.PORT, () => {
        console.log(`Server listening on port ${process.env.PORT}...`)
    });
}

main().catch((err) => {
    console.log(err);
});

