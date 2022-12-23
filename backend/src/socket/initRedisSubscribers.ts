import Redis from "ioredis";
import { Socket as SocketServer } from "socket.io";

export enum RedisChannel {
    MESSAGE = "messages",
    NEW_MEMBER = "new_member",
    MEMBER_LEFT = "member_left",
    ROOM_INFO = "room_info",
    STREAMING_EVENTS = "streaming_events",
}

const addRedisSubscriber = (
    io: SocketServer,
    subscriber_key: string
): Redis => {
    let client = new Redis(process.env.REDIS_ADDRESS as string);

    client.subscribe(subscriber_key);
    client.on("message", (channel, message) => {
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
    const channels = Object.values(RedisChannel);

    for (const channel of channels) {
        redisSubscribers.set(channel, addRedisSubscriber(io, channel));
    }

    return redisSubscribers;
};

export default initRedisSubscribers;
