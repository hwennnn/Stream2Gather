import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { createServer } from "http";
import Redis from 'ioredis';
import { Server } from "socket.io";

dotenv.config()

const PORT = process.env.PORT;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN,
        methods: ["GET", "POST"]
    }
});

/**
 *  App Configuration
 */
app.use(helmet()); //safety
app.use(cors()); //safety
app.use(
    (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ): void => {
        express.json()(req, res, next);
    }
);


/**
 * Server Activation
 */
app.get("/health", (req, res) => {
    res.send("ok");
});

//The 404 Route (ALWAYS Keep this as the last route)
app.use('*', function (req: Request, res: Response) {
    res.sendStatus(404);
});

const redisAddress = process.env.REDIS_ADDRESS || 'redis://127.0.0.1:6379';
const redis = new Redis(redisAddress);
const redisSubscribers = initRedisSubscribers();

function addRedisSubscriber(subscriber_key: string) {
    var client = new Redis(redisAddress);

    client.subscribe(subscriber_key);
    client.on('message', function (channel, message) {
        message = JSON.parse(message);
        const { roomID } = message;
        if (roomID !== undefined && roomID !== null) {
            io.to(roomID).emit(subscriber_key, message);
        }
    });

    return client;
}

function initRedisSubscribers() {
    var redisSubscribers = {};
    const channels = ['messages', 'member_add', 'member_left'];

    for (const channel of channels) {
        redisSubscribers[channel] = addRedisSubscriber(channel);
    }

    return redisSubscribers;
}

interface RoomMembers {
    uid: string;
    socketID: string;
    roomID: string;
}

function getMembersDBKey(roomID: string) {
    return `${roomID}_members`;
}

async function getMembers(roomID: string) {
    var redis_members = await redis.hgetall(getMembersDBKey(roomID));
    var members = {};
    for (var key in redis_members) {
        members[key] = JSON.parse(redis_members[key]);
    }
    return members;
}

async function getMember(socketID: string) {
    var member = await redis.hget('members', socketID);
    return JSON.parse(member);
}

io.on("connection", (socket) => {
    // cache the current room id on the socket (scoped)
    let currentRoomID: string = null;
    // console.log("New client connected", socket.id);
    // socket.emit("Welcome to Stream2Gether. " + socket.id);

    socket.on('join-room', async ({ uid, roomID }: { uid: string, roomID: string }) => {
        console.log(`${socket.id} has joined the room with id ${roomID}`);
        socket.join(roomID);
        currentRoomID = roomID;

        const member: RoomMembers = { uid: uid, socketID: socket.id, roomID: roomID };
        await redis.hset(getMembersDBKey(roomID), socket.id, JSON.stringify(member));
        await redis.publish('member_add', JSON.stringify(member));
    });

    // Runs when client disconnects
    socket.on('disconnect', async () => {
        console.log(`${socket.id} has left the room with id ${currentRoomID}`);
        const payload = {
            roomID: currentRoomID,
            socketID: socket.id,
        };
        await redis.hdel(getMembersDBKey(currentRoomID), socket.id);
        await redis.publish('member_left', JSON.stringify(payload));
    });
});

httpServer.listen(PORT);