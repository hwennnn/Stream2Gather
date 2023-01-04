import { Socket } from 'socket.io';
import { Room } from '../entities/Room';
import { RoomMember } from '../models/RedisModel';
import RedisHelper from '../utils/redisHelper';
import RedisRoomHelper from '../utils/redisRoomHelper';
import { RES_NEW_MEMBER } from './../constants/socket';

type JoinRoomFunction = ({
  uid,
  username,
  roomSlug
}: {
  uid: string;
  username: string;
  roomSlug: string;
}) => Promise<void>;

export const handleJoinRoom = (
  socket: Socket,
  redisHelper: RedisHelper,
  redisRoomHelper: RedisRoomHelper
): JoinRoomFunction => {
  return async ({ uid, roomSlug, username }): Promise<void> => {
    const room = await Room.findOne({ where: { slug: roomSlug } });

    if (room === null) {
      throw new Error('Room not found');
    }

    const roomId = room.id;

    const member: RoomMember = {
      socketId: socket.id,
      roomId,
      uid,
      username
    };
    console.log(`${username} has joined the room with id ${roomId}`);

    await socket.join(roomId);
    socket.roomId = roomId;

    await redisRoomHelper.updateRoomMember(roomId, socket.id, member);
    await redisHelper.publish(RES_NEW_MEMBER, member);

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
