import { Socket } from 'socket.io';
import RedisHelper from '../utils/redisHelper';
import RedisRoomHelper from '../utils/redisRoomHelper';
import { RES_STREAMING_EVENTS } from './../constants/socket';

type StreamEventFunction = ({
  isPlaying,
  timestamp
}: {
  isPlaying: boolean;
  timestamp: number;
}) => Promise<void>;

export const handleStreamingEvents = (
  socket: Socket,
  redisHelper: RedisHelper,
  redisRoomHelper: RedisRoomHelper
): StreamEventFunction => {
  return async ({ isPlaying, timestamp }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    roomInfo.playedSeconds = timestamp;
    roomInfo.playedTimestampUpdatedAt = new Date().getTime().toString();
    roomInfo.isPlaying = isPlaying;

    const payload = {
      roomId,
      playedSeconds: roomInfo.playedSeconds,
      playedTimestampUpdatedAt: roomInfo.playedTimestampUpdatedAt,
      isPlaying: roomInfo.isPlaying
    };

    await redisRoomHelper.setRoomInfo(roomId, roomInfo);

    await redisHelper.publish(RES_STREAMING_EVENTS, payload);
  };
};
