import { RoomInfoType } from '@src/constants/rooms';
import { RES_ROOM_INFO } from '@src/constants/socket';
import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Socket } from 'socket.io';

type PlayExistingVideoFunction = ({
  playingIndex
}: {
  playingIndex: number;
}) => Promise<void>;

export const handlePlayExistingVideo = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
): PlayExistingVideoFunction => {
  return async ({ playingIndex }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    if (playingIndex >= roomInfo.playlist.length) return;

    roomInfo.playingIndex = playingIndex;
    roomInfo.currentVideo = roomInfo.playlist[playingIndex];
    roomInfo.playedSeconds = 0;
    roomInfo.playedTimestampUpdatedAt = new Date().getTime().toString();
    roomInfo.isPlaying = true;

    await redisRoomHelper.setRoomInfo(roomId, roomInfo);
    await redisRoomHelper.publish(RES_ROOM_INFO, {
      roomId,
      type: RoomInfoType.UPDATE_PLAYING_INDEX,
      roomInfo
    });
  };
};
