import { Request, Response } from "express";
import { Redis } from "ioredis";
import RedisRoomHelper from "./utils/redisRoomHelper";

export interface MyContext {
    req: Request;
    res: Response;
    redis: Redis;
    redisRoomHelper: RedisRoomHelper;
}
