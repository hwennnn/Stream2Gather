import { Socket } from 'socket.io';
import { RES_ROOM_INFO } from '../constants/socket';
import { VideoInfo } from '../models/RedisModel';
import { RoomInfoType } from './../constants/rooms';

import RedisRoomHelper from '../utils/redisRoomHelper';

type AddToPlaylistFunction = ({
  videoInfo
}: {
  videoInfo: VideoInfo;
}) => Promise<void>;

export const handleAddToPlaylist = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
): AddToPlaylistFunction => {
  return async ({ videoInfo }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    roomInfo.playlist.push(videoInfo);

    await redisRoomHelper.setRoomInfo(roomId, roomInfo);
    await redisRoomHelper.publish(RES_ROOM_INFO, {
      roomId,
      type: RoomInfoType.ADD_TO_QUEUE,
      videoInfo
    });
  };
};
