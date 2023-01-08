import { Socket } from 'socket.io';
import { RoomInfoType } from '../constants/rooms';
import { RES_ROOM_INFO } from '../constants/socket';
import { VideoInfo } from '../models/RedisModel';

import RedisRoomHelper from '../utils/redisRoomHelper';

type PlayNewVideoFunction = ({
  videoInfo
}: {
  videoInfo: VideoInfo;
}) => Promise<void>;

export const handlePlayNewVideo = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
): PlayNewVideoFunction => {
  return async ({ videoInfo }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    roomInfo.playlist.push(videoInfo);
    roomInfo.playingIndex = roomInfo.playlist.length - 1;

    roomInfo.currentVideo = videoInfo;
    roomInfo.playedSeconds = 0;
    roomInfo.playedTimestampUpdatedAt = '0';
    roomInfo.isPlaying = true;

    await redisRoomHelper.setRoomInfo(roomId, roomInfo);
    await redisRoomHelper.publish(RES_ROOM_INFO, {
      roomId,
      type: RoomInfoType.UPDATE_PLAYLIST,
      roomInfo
    });
  };
};
