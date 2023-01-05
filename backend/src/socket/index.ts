import {
  CONNECT,
  DISCONNECT,
  REQ_JOIN_ROOM,
  REQ_PLAY_VIDEO,
  REQ_STREAMING_EVENTS
} from '@src/constants/socket';
import { handleDisconnect } from '@src/socket/handleDisconnect';
import { handleJoinRoom } from '@src/socket/handleJoinRoom';
import { handlePlayVideo } from '@src/socket/handlePlayVideo';
import { handleStreamingEvents } from '@src/socket/handleStreamingEvents';
import initRedisSubscribers from '@src/socket/initRedisSubscribers';
import RedisHelper from '@src/utils/redisHelper';
import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Redis } from 'ioredis';
import { Server as SocketServer } from 'socket.io';

const setUpIo = async (io: SocketServer, redis: Redis): Promise<void> => {
  const redisHelper = new RedisHelper(redis);
  const redisRoomHelper = new RedisRoomHelper(redis);

  await initRedisSubscribers(io);

  io.on(CONNECT, (socket) => {
    socket.on(
      REQ_JOIN_ROOM,
      handleJoinRoom(socket, redisHelper, redisRoomHelper)
    );

    socket.on(REQ_PLAY_VIDEO, handlePlayVideo(socket, redisRoomHelper));

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
