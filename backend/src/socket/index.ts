import { handleDisconnect } from "./handleDisconnet";
import { handleStreamingEvents } from "./handleStreamingEvents";
import { handleJoinRoom } from "./handleJoinRoom";
import { Redis } from "ioredis";
import { Server as SocketServer } from "socket.io";
import initRedisSubscribers from "../utils/initRedisSubscribers";
import RedisHelper from "../utils/redisHelper";
import RedisRoomHelper from "../utils/redisRoomHelper";

const setUpIo = (io: SocketServer, redis: Redis): void => {
    const redisHelper = new RedisHelper(redis);
    const redisRoomHelper = new RedisRoomHelper(redis);

    initRedisSubscribers(io);

    io.on("connection", (socket) => {
        socket.on(
            "join-room",
            handleJoinRoom(socket, redisHelper, redisRoomHelper)
        );

        socket.on(
            "video-events",
            handleStreamingEvents(redisHelper, redisRoomHelper)
        );

        socket.on(
            "disconnect",
            handleDisconnect(socket, redisHelper, redisRoomHelper)
        );
    });
};

export default setUpIo;
