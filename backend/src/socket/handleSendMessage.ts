import { Socket } from 'socket.io';
import { Message } from '../entities/Message';
import RedisHelper from '../utils/redisHelper';
import { RES_NEW_MESSAGE } from './../constants/socket';

type SendMessageFunction = ({ content }: { content: string }) => Promise<void>;

export const handleSendMessage = (
  socket: Socket,
  redisHelper: RedisHelper
): SendMessageFunction => {
  return async ({ content }): Promise<void> => {
    const roomId = socket.roomId;
    const uid = socket.uid;

    if (roomId === undefined || uid === undefined) return;

    try {
      const message = await Message.create({
        content,
        room: { id: roomId },
        creatorId: uid
      }).save();

      const payload = {
        roomId,
        ...message
      };

      await redisHelper.publish(RES_NEW_MESSAGE, payload);
    } catch (err) {
      console.error(err);
    }
  };
};
