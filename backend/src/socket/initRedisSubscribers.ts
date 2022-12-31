import Redis from 'ioredis';
import { Server } from 'socket.io';
import { REDIS_PUB_MESSAGE } from '../constants/socket';
import {
  RES_MEMBER_LEFT,
  RES_MESSAGE,
  RES_NEW_MEMBER,
  RES_STREAMING_EVENTS
} from './../constants/socket';

const addRedisSubscriber = async (
  subscriberKey: string,
  io: Server
): Promise<Redis> => {
  const client = new Redis(process.env.REDIS_ADDRESS);

  await client.subscribe(subscriberKey);
  client.on(REDIS_PUB_MESSAGE, function (_channel, message) {
    message = JSON.parse(message);
    const { roomId, receiverSocketId } = message;
    // console.log(_channel, roomId ?? receiverSocketId, message);
    if (receiverSocketId !== undefined && receiverSocketId !== null) {
      io.to(receiverSocketId).emit(subscriberKey, message);
    } else if (roomId !== undefined && roomId !== null) {
      io.to(roomId).emit(subscriberKey, message);
    }
  });

  return client;
};

const initRedisSubscribers = async (
  io: Server
): Promise<Map<String, Redis>> => {
  const redisSubscribers = new Map<String, Redis>();
  const channels = [
    RES_MESSAGE,
    RES_NEW_MEMBER,
    RES_MEMBER_LEFT,
    RES_STREAMING_EVENTS
  ];

  for (const channel of channels) {
    redisSubscribers.set(channel, await addRedisSubscriber(channel, io));
  }

  return redisSubscribers;
};

export default initRedisSubscribers;
