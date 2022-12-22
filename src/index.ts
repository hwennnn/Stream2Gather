import "reflect-metadata";
import "dotenv-safe/config";

import {
    ApolloServerPluginLandingPageLocalDefault,
    ApolloServerPluginLandingPageProductionDefault,
} from "@apollo/server/plugin/landingPage/default";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { AppDataSource } from "./data-source";
import { buildSchema } from "type-graphql";
import { COOKIE_NAME, __prod__ } from "./constants";
import { createServer } from "http";
import { expressMiddleware } from "@apollo/server/express4";
import { json } from "body-parser";
import { MyContext } from "./types";
import { Room } from "./entities/Room";
import { RoomResolver } from "./resolvers/roomResolver";
import { User } from "./entities/User";
import { UserResolver } from "./resolvers/userResolver";
import connectRedis from "connect-redis";
import cors from "cors";
import CustomSocket from "./models/custom_socket";
import express, { Request, Response } from "express";
import Redis from "ioredis";
import session from "express-session";

const main = async () => {
    await AppDataSource.initialize();

    const app = express();
    const RedisStore = connectRedis(session);
    const httpServer = createServer(app);

    const redis = new Redis(process.env.REDIS_ADDRESS as string);
    const socket = new CustomSocket(httpServer, redis);
    // await User.delete({});
    // await Room.delete({});

    app.set("trust proxy", !__prod__);
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
            resolvers: [UserResolver, RoomResolver],
            validate: false,
        }),
        plugins: [
            ApolloServerPluginDrainHttpServer({ httpServer }),
            process.env.NODE_ENV === "production"
                ? ApolloServerPluginLandingPageProductionDefault({
                      graphRef: "my-graph-id@my-graph-variant",
                      footer: false,
                  })
                : ApolloServerPluginLandingPageLocalDefault({
                      footer: false,
                      includeCookies: true,
                  }),
        ],
    });

    await apolloServer.start();

    app.use(
        "/graphql",
        cors<cors.CorsRequest>(),
        json(),
        expressMiddleware(apolloServer, {
            context: async ({ req, res }) => ({ req, res, redis }),
        })
    );

    //The 404 Route (ALWAYS Keep this as the last route)
    app.use("*", function (req: Request, res: Response) {
        res.sendStatus(404);
    });

    httpServer.listen(process.env.PORT, () => {
        console.log(`Server listening on port ${process.env.PORT}...`);
    });
};

main().catch((err) => {
    console.error(err);
});
