import {
  CONNECT,
  DISCONNECT,
  REQ_ADD_TO_PLAYLIST,
  REQ_ADD_VIDEO_ID_TO_PLAYLIST,
  REQ_JOIN_ROOM,
  REQ_PLAY_EXISTING_VIDEO,
  REQ_PLAY_NEW_VIDEO,
  REQ_PLAY_NEXT_VIDEO,
  REQ_PLAY_VIDEO,
  REQ_REMOVE_FROM_PLAYLIST,
  REQ_RESET_QUEUE,
  REQ_SEND_MESSAGE,
  REQ_STREAMING_EVENTS
} from '@src/constants/socket';
import { handleAddToPlaylist } from '@src/socket/handleAddToPlaylist';
import { handleAddVideoIdToPlaylist } from '@src/socket/handleAddVideoIdToPlaylist';
import { handleDisconnect } from '@src/socket/handleDisconnect';
import { handleJoinRoom } from '@src/socket/handleJoinRoom';
import { handlePlayExistingVideo } from '@src/socket/handlePlayExistingVideo';
import { handlePlayNewVideo } from '@src/socket/handlePlayNewVideo';
import { handlePlayNextVideo } from '@src/socket/handlePlayNextVideo';
import { handlePlayVideo } from '@src/socket/handlePlayVideo';
import { handleRemoveFromPlaylist } from '@src/socket/handleRemoveFromPlaylist';
import { handleResetQueue } from '@src/socket/handleResetQueue';
import { handleSendMessage } from '@src/socket/handleSendMessage';
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
      handleStreamingEvents(socket, redisHelper, redisRoomHelper)
    );

    socket.on(
      REQ_ADD_VIDEO_ID_TO_PLAYLIST,
      handleAddVideoIdToPlaylist(socket, redisRoomHelper)
    );

    socket.on(
      REQ_ADD_TO_PLAYLIST,
      handleAddToPlaylist(socket, redisRoomHelper)
    );

    socket.on(
      REQ_REMOVE_FROM_PLAYLIST,
      handleRemoveFromPlaylist(socket, redisRoomHelper)
    );

    socket.on(REQ_RESET_QUEUE, handleResetQueue(socket, redisRoomHelper));

    socket.on(REQ_PLAY_NEW_VIDEO, handlePlayNewVideo(socket, redisRoomHelper));

    socket.on(
      REQ_PLAY_NEXT_VIDEO,
      handlePlayNextVideo(socket, redisRoomHelper)
    );

    socket.on(
      REQ_PLAY_EXISTING_VIDEO,
      handlePlayExistingVideo(socket, redisRoomHelper)
    );

    socket.on(REQ_SEND_MESSAGE, handleSendMessage(socket, redisRoomHelper));

    socket.on(
      DISCONNECT,
      handleDisconnect(socket, redisHelper, redisRoomHelper)
    );
  });
};

export default setUpIo;
