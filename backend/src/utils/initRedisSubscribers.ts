import Redis from "ioredis";
import { Server } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";

function addRedisSubscriber(
    subscriber_key: string,
    io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>
) {
    var client = new Redis(process.env.REDIS_ADDRESS as string);

    client.subscribe(subscriber_key);
    client.on("message", function (channel, message) {
        message = JSON.parse(message);
        const { roomID, receiverSocketID } = message;
        if (receiverSocketID !== undefined && receiverSocketID !== null) {
            io.to(receiverSocketID).emit(subscriber_key, message);
        } else if (roomID !== undefined && roomID !== null) {
            io.to(roomID).emit(subscriber_key, message);
        }
    });

    return client;
}

export default function initRedisSubscribers(
    io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>
) {
    var redisSubscribers = new Map<String, Redis>();
    const channels = [
        "messages",
        "member_add",
        "member_left",
        "room_info",
        "video_events",
    ];

    for (const channel of channels) {
        redisSubscribers.set(channel, addRedisSubscriber(channel, io));
    }

    return redisSubscribers;
}
