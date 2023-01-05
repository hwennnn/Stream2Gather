import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Request, Response } from 'express';

export interface MyContext {
  req: Request;
  res: Response;
  redisRoomHelper: RedisRoomHelper;
}
