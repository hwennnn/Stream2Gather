import { RoomInfoType } from '@src/constants/rooms';
import { RES_ROOM_INFO } from '@src/constants/socket';
import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Socket } from 'socket.io';

export const handleResetQueue = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
) => {
  return async (): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    roomInfo.playlist = [roomInfo.currentVideo];
    roomInfo.playingIndex = 0;

    await redisRoomHelper.setRoomInfo(roomId, roomInfo);
    await redisRoomHelper.publish(RES_ROOM_INFO, {
      roomId,
      type: RoomInfoType.RESET_QUEUE,
      roomInfo
    });
  };
};
