import Redis from "ioredis";
import { Server } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import { REDIS_PUB_MESSAGE } from "../constants/socket";
import {
    RES_MEMBER_LEFT,
    RES_MESSAGE,
    RES_NEW_MEMBER,
    RES_ROOM_INFO,
    RES_STREAMING_EVENTS,
} from "./../constants/socket";

function addRedisSubscriber(
    subscriber_key: string,
    io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>
) {
    var client = new Redis(process.env.REDIS_ADDRESS as string);

    client.subscribe(subscriber_key);
    client.on(REDIS_PUB_MESSAGE, function (_channel, message) {
        message = JSON.parse(message);
        const { roomId, receiverSocketId } = message;
        // console.log(_channel, roomId ?? receiverSocketId, message);
        if (receiverSocketId !== undefined && receiverSocketId !== null) {
            io.to(receiverSocketId).emit(subscriber_key, message);
        } else if (roomId !== undefined && roomId !== null) {
            io.to(roomId).emit(subscriber_key, message);
        }
    });

    return client;
}

export default function initRedisSubscribers(
    io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>
) {
    var redisSubscribers = new Map<String, Redis>();
    const channels = [
        RES_MESSAGE,
        RES_NEW_MEMBER,
        RES_MEMBER_LEFT,
        RES_ROOM_INFO,
        RES_STREAMING_EVENTS,
    ];

    for (const channel of channels) {
        redisSubscribers.set(channel, addRedisSubscriber(channel, io));
    }

    return redisSubscribers;
}
