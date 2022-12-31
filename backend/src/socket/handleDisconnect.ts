import { Socket } from 'socket.io';
import { RES_MEMBER_LEFT } from '../constants/socket';
import RedisHelper from '../utils/redisHelper';
import RedisRoomHelper from '../utils/redisRoomHelper';

type DisconnectFunction = () => Promise<void>;

export const handleDisconnect = (
  socket: Socket,
  redisHelper: RedisHelper,
  redisRoomHelper: RedisRoomHelper
): DisconnectFunction => {
  return async (): Promise<void> => {
    const currentRoomId = socket.roomId;

    if (currentRoomId === undefined) {
      return;
    }

    console.log(`${socket.id} has left the room with id ${currentRoomId}`);
    const payload = {
      roomId: currentRoomId,
      socketId: socket.id
    };

    await redisRoomHelper.removeRoomMember(currentRoomId, socket.id);
    await redisHelper.publish(RES_MEMBER_LEFT, payload);

    await stopVideoWhenLastMemberLeft(redisRoomHelper, currentRoomId);
  };
};

const stopVideoWhenLastMemberLeft = async (
  redisRoomHelper: RedisRoomHelper,
  roomId: string
): Promise<void> => {
  const activeMembers = await redisRoomHelper.getActiveMembers(roomId);

  if (activeMembers.length !== 0) {
    return;
  }

  const roomInfo = await redisRoomHelper.getRoomInfo(roomId);

  if (roomInfo === null) {
    return;
  }

  const { playedSeconds, playedTimestampUpdatedAt } = roomInfo;

  const currentTimestamp =
    playedSeconds +
    (playedTimestampUpdatedAt === '0'
      ? 0
      : (Date.now() - Number.parseInt(playedTimestampUpdatedAt)) / 1000);
  console.log(currentTimestamp);
  roomInfo.playedSeconds = currentTimestamp;
  roomInfo.playedTimestampUpdatedAt = '0';
  roomInfo.isPlaying = false;

  await redisRoomHelper.setRoomInfo(roomId, roomInfo);
};
