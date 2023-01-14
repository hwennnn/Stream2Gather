import { Socket } from 'socket.io';
import { RoomInfoType } from '../constants/rooms';
import { RES_ROOM_INFO } from '../constants/socket';

import videoInfoApi from '../lib/videoInfoApi';
import RedisRoomHelper from '../utils/redisRoomHelper';

type AddVideoIdToPlaylistFunction = ({
  videoId
}: {
  videoId: string;
}) => Promise<void>;

export const handleAddVideoIdToPlaylist = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
): AddVideoIdToPlaylistFunction => {
  return async ({ videoId }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    const videoInfo = await videoInfoApi.getYoutubeVideoInfo(videoId);

    if (videoInfo === null) return;

    roomInfo.playlist.push(videoInfo);

    await redisRoomHelper.setRoomInfo(roomId, roomInfo);
    await redisRoomHelper.publish(RES_ROOM_INFO, {
      roomId,
      type: RoomInfoType.ADD_TO_QUEUE,
      videoInfo
    });
  };
};
