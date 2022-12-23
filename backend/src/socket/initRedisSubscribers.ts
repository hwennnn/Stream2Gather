import Redis from "ioredis";
import { Socket as SocketServer } from "socket.io";
import {
    REDIS_PUB_MESSAGE,
    RES_MEMBER_LEFT,
    RES_MESSAGE,
    RES_NEW_MEMBER,
    RES_ROOM_INFO,
    RES_STREAMING_EVENTS,
} from "./../constants/socket";

const addRedisSubscriber = (
    io: SocketServer,
    subscriber_key: string
): Redis => {
    let client = new Redis(process.env.REDIS_ADDRESS as string);

    client.subscribe(subscriber_key);
    client.on(REDIS_PUB_MESSAGE, (_channel, message) => {
        message = JSON.parse(message);
        const { roomId, receiverSocketId } = message;
        if (receiverSocketId !== undefined && receiverSocketId !== null) {
            io.to(receiverSocketId).emit(subscriber_key, message);
        } else if (roomId !== undefined && roomId !== null) {
            io.to(roomId).emit(subscriber_key, message);
        }
    });

    return client;
};

const initRedisSubscribers = (io: SocketServer): Map<String, Redis> => {
    let redisSubscribers = new Map<String, Redis>();
    const channels = [
        RES_MESSAGE,
        RES_NEW_MEMBER,
        RES_MEMBER_LEFT,
        RES_ROOM_INFO,
        RES_STREAMING_EVENTS,
    ];

    for (const channel of channels) {
        redisSubscribers.set(channel, addRedisSubscriber(io, channel));
    }

    return redisSubscribers;
};

export default initRedisSubscribers;
