import {
  RES_JOINED_ROOM,
  RES_NEW_MEMBER,
  RES_ROOM_ALREADY_JOINED,
  RES_ROOM_DOES_NOT_EXIST,
  RES_ROOM_INACTIVE,
  RES_ROOM_NO_PERMISSION
} from '@src/constants/socket';
import { Room } from '@src/entities/Room';
import { RoomMember } from '@src/models/RedisModel';
import RedisHelper from '@src/utils/redisHelper';
import RedisRoomHelper from '@src/utils/redisRoomHelper';
import { Socket } from 'socket.io';

type JoinRoomFunction = ({
  uid,
  username,
  slug
}: {
  uid: string;
  username: string;
  slug: string;
}) => Promise<void>;

export const handleJoinRoom = (
  socket: Socket,
  redisHelper: RedisHelper,
  redisRoomHelper: RedisRoomHelper
): JoinRoomFunction => {
  return async ({ uid, slug, username }): Promise<void> => {
    const room = await Room.findOne({
      where: { slug },
      relations: {
        members: true
      }
    });

    if (room === null) {
      socket.emit(RES_ROOM_DOES_NOT_EXIST);
      return;
    }

    if (!room.isPublic && room.members.every((m) => m.id !== uid)) {
      socket.emit(RES_ROOM_NO_PERMISSION);
      return;
    }

    if (!room.isActive) {
      socket.emit(RES_ROOM_INACTIVE);
      return;
    }

    const activeMembers = await redisRoomHelper.getActiveMembers(room.id);

    if (activeMembers.some((m) => m.uid === uid)) {
      socket.emit(RES_ROOM_ALREADY_JOINED);
      return;
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

    socket.emit(RES_JOINED_ROOM);

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
