import { RES_STREAMING_EVENTS } from '@src/constants/socket';
import RedisHelper from '@src/utils/redisHelper';
import RedisRoomHelper from '@src/utils/redisRoomHelper';

type StreamEventFunction = ({
  roomId,
  isPlaying,
  timestamp
}: {
  roomId: string;
  isPlaying: boolean;
  timestamp: number;
}) => Promise<void>;

export const handleStreamingEvents = (
  redisHelper: RedisHelper,
  redisRoomHelper: RedisRoomHelper
): StreamEventFunction => {
  return async ({ roomId, isPlaying, timestamp }): Promise<void> => {
    console.log(
      `video-events: ${roomId}, ${isPlaying ? 'play' : 'stop'}, ${timestamp}`
    );
    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) {
      return;
    }

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
