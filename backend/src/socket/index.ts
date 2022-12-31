import { Redis } from 'ioredis';
import { Server as SocketServer } from 'socket.io';
import RedisHelper from '../utils/redisHelper';
import RedisRoomHelper from '../utils/redisRoomHelper';
import {
  CONNECT,
  DISCONNECT,
  REQ_JOIN_ROOM,
  REQ_STREAMING_EVENTS
} from './../constants/socket';
import { handleDisconnect } from './handleDisconnect';
import { handleJoinRoom } from './handleJoinRoom';
import { handleStreamingEvents } from './handleStreamingEvents';
import initRedisSubscribers from './initRedisSubscribers';

const setUpIo = async (io: SocketServer, redis: Redis): Promise<void> => {
  const redisHelper = new RedisHelper(redis);
  const redisRoomHelper = new RedisRoomHelper(redis);

  await initRedisSubscribers(io);

  io.on(CONNECT, (socket) => {
    socket.on(
      REQ_JOIN_ROOM,
      handleJoinRoom(socket, redisHelper, redisRoomHelper)
    );

    socket.on(
      REQ_STREAMING_EVENTS,
      handleStreamingEvents(redisHelper, redisRoomHelper)
    );

    socket.on(
      DISCONNECT,
      handleDisconnect(socket, redisHelper, redisRoomHelper)
    );
  });
};

export default setUpIo;
