import { Redis } from "ioredis";
import connectRedis from "connect-redis";
import session, { SessionOptions } from "express-session";
import { COOKIE_NAME, __prod__ } from "../constants/config";

const RedisStore = connectRedis(session);

function sessionOptions(redis: Redis): SessionOptions {
    return {
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
    };
}

export default sessionOptions;
