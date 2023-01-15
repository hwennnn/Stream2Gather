import { RoomInfoType } from '@src/constants/rooms';
import { RES_ROOM_INFO } from '@src/constants/socket';
import { VideoInfo } from '@src/models/RedisModel';
import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Socket } from 'socket.io';

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
