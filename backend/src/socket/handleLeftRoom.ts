import { Socket } from 'socket.io';
import RedisHelper from '../utils/redisHelper';
import RedisRoomHelper from '../utils/redisRoomHelper';

type JoinRoomFunction = ({ roomId }: { roomId: string }) => Promise<void>;

export const handleLeftRoom = (
  socket: Socket,
  redisHelper: RedisHelper,
  redisRoomHelper: RedisRoomHelper
): JoinRoomFunction => {
  return async ({ roomId }): Promise<void> => {
    console.log(`${socket.id} has left the room with id ${roomId}~`);

    // Promise.all([
    //   redisRoomHelper.getRoomInfo(roomId),
    //   redisRoomHelper.updateRoomMember(roomId, socket.id, member)
    // ]).then(async ([roomInfo, _]) => {
    //   console.log('roomInfo', roomInfo);

    //   await redisHelper.publish(RES_NEW_MEMBER, member);

    //   // post to current socket only
    //   // await redisHelper.publish(RES_ROOM_INFO, roomInfo, socket.id);
    // });
  };
};
