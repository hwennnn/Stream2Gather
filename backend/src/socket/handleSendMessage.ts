import { RES_NEW_MESSAGE } from '@src/constants/socket';
import { Message } from '@src/entities/Message';
import RedisHelper from '@src/utils/redisHelper';
import BadWords from 'bad-words';
import { Socket } from 'socket.io';

type SendMessageFunction = ({ content }: { content: string }) => Promise<void>;

export const handleSendMessage = (
  socket: Socket,
  redisHelper: RedisHelper
): SendMessageFunction => {
  return async ({ content }): Promise<void> => {
    const roomId = socket.roomId;
    const uid = socket.uid;

    if (roomId === undefined || uid === undefined) return;

    const filter = new BadWords();
    content = filter.clean(content);

    try {
      const message = await Message.create({
        content,
        room: { id: roomId },
        creatorId: uid
      }).save();

      const createdAt = message.createdAt.getTime().toString();

      const payload = {
        roomId,
        message: {
          ...message,
          createdAt
        }
      };

      await redisHelper.publish(RES_NEW_MESSAGE, payload);
    } catch (err) {
      console.error(err);
    }
  };
};
