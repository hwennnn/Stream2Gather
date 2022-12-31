import { Request, Response } from 'express';
import RedisRoomHelper from './utils/redisRoomHelper';

export interface MyContext {
  req: Request;
  res: Response;
  redisRoomHelper: RedisRoomHelper;
}
