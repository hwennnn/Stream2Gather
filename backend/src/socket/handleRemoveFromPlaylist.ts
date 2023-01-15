import { RoomInfoType } from '@src/constants/rooms';
import { RES_ROOM_INFO } from '@src/constants/socket';
import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Socket } from 'socket.io';

type RemovePlaylistFunction = ({
  removingIndex
}: {
  removingIndex: number;
}) => Promise<void>;

export const handleRemoveFromPlaylist = (
  socket: Socket,
  redisRoomHelper: RedisRoomHelper
): RemovePlaylistFunction => {
  return async ({ removingIndex }): Promise<void> => {
    const roomId = socket.roomId;

    if (roomId === undefined) return;

    const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

    if (roomInfo === null) return;

    if (removingIndex >= roomInfo.playlist.length) return;

    roomInfo.playlist.splice(removingIndex, 1);
    const newPlayingIndex = roomInfo.playlist.findIndex(
      (video) => video.id === roomInfo.currentVideo.id
    );
    if (newPlayingIndex === -1) return;
    roomInfo.playingIndex = newPlayingIndex;

    await redisRoomHelper.setRoomInfo(roomId, roomInfo);
    await redisRoomHelper.publish(RES_ROOM_INFO, {
      roomId,
      type: RoomInfoType.UPDATE_PLAYLIST,
      roomInfo
    });
  };
};
