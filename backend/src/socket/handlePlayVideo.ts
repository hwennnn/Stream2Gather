import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Socket } from 'socket.io';

type PlayVideoFunction = ({
  isPlaying,
  playedTimestampUpdatedAt
}: {
  isPlaying: boolean;
  playedTimestampUpdatedAt: string;
}) => Promise<void>;

export const handlePlayVideo = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
): PlayVideoFunction => {
  return async ({ isPlaying, playedTimestampUpdatedAt }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const videoInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (videoInfo === null) return;

    videoInfo.isPlaying = isPlaying;
    videoInfo.playedTimestampUpdatedAt = playedTimestampUpdatedAt;

    await redisRoomHelper.setRoomInfo(roomId, videoInfo);
  };
};
