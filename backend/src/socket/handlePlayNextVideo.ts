import { Socket } from 'socket.io';
import { RoomInfoType } from '../constants/rooms';
import { RES_ROOM_INFO } from '../constants/socket';
import RedisRoomHelper from '../utils/redisRoomHelper';

type PlayNextVideoFunction = ({
  playingIndex
}: {
  playingIndex: number;
}) => Promise<void>;

export const handlePlayNextVideo = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
): PlayNextVideoFunction => {
  return async ({ playingIndex }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    // handle duplicate update and invalid index
    if (
      roomInfo.playingIndex === playingIndex ||
      playingIndex >= roomInfo.playlist.length
    ) {
      return;
    }

    console.log(
      'handlePlayNextVideo',
      socket.id,
      playingIndex,
      roomInfo.playingIndex,
      new Date().getTime().toString()
    );

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
