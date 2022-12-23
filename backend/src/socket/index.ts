import {
    CONNECT,
    REQ_JOIN_ROOM,
    REQ_STREAMING_EVENTS,
    DISCONNECT,
} from "./../constants/socket";
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

    io.on(CONNECT, (socket) => {
        socket.on(
            REQ_JOIN_ROOM,
            handleJoinRoom(socket, redisHelper, redisRoomHelper)
        );

        socket.on(
            REQ_STREAMING_EVENTS,
            handleStreamingEvents(redisHelper, redisRoomHelper)
        );

        socket.on(
            DISCONNECT,
            handleDisconnect(socket, redisHelper, redisRoomHelper)
        );
    });
};

export default setUpIo;
