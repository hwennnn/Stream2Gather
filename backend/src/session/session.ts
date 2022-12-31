import connectRedis from 'connect-redis';
import session, { SessionOptions } from 'express-session';
import { Redis } from 'ioredis';
import { COOKIE_NAME, isProd } from '../constants/config';

const RedisStore = connectRedis(session);

function sessionOptions(redis: Redis): SessionOptions {
  return {
    name: COOKIE_NAME,
    store: new RedisStore({
      client: redis as any,
      disableTouch: true
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
      httpOnly: true,
      sameSite: 'lax', // csrf
      secure: isProd, // cookie only works in https
      domain: isProd ? '.cloudrun.com' : undefined
    },
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET,
    resave: false
  };
}

export default sessionOptions;
