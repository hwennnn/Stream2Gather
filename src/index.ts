import { RoomInfo, RoomMember, VideoInfo } from 'core/models/rooms';
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
        const { roomID, receiverSocketID } = message;
        if (receiverSocketID !== undefined && receiverSocketID !== null) {
            io.to(receiverSocketID).emit(subscriber_key, message);
        }
        else if (roomID !== undefined && roomID !== null) {
            io.to(roomID).emit(subscriber_key, message);
        }
    });

    return client;
}

function initRedisSubscribers() {
    var redisSubscribers = {};
    const channels = ['messages', 'member_add', 'member_left', "room_info", "video_events"];

    for (const channel of channels) {
        redisSubscribers[channel] = addRedisSubscriber(channel);
    }

    return redisSubscribers;
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

async function getRoomInfo(roomID: string) {
    var roomInfo = await redis.hget("room_info", roomID);
    return JSON.parse(roomInfo);
}

async function setRoomInfo(roomID: string, roomInfo?: any) {
    const defaultVideoInfo: VideoInfo = {
        playedTimestamp: "0",
        lastTimestampUpdatedTime: new Date().getTime().toString(),
        videoID: "Y8JFxS1HlDo",
        videoURL: "https://youtu.be/Y8JFxS1HlDo",
        thumbnailURL: "",
        videoTitle: "",
        videoAuthor: "",
        isPlaying: true,
    };

    const defaultRoomInfo: RoomInfo = {
        roomID: roomID,
        currentURL: "https://youtu.be/Y8JFxS1HlDo",
        playingIndex: 0,
        playlist: [defaultVideoInfo]
    };

    roomInfo ??= defaultRoomInfo;
    await redis.hset("room_info", roomID, JSON.stringify(roomInfo));

    return roomInfo;
}

function addReceiverSocketID(message: any, receiverSocketID: string) {
    message.receiverSocketID = receiverSocketID;
    return message;
};

io.on("connection", (socket) => {
    // cache the current room id on the socket (scoped)
    let currentRoomID: string = null;
    // console.log("New client connected", socket.id);
    // socket.emit("Welcome to Stream2Gether. " + socket.id);

    const getRoomInfoOrSetDefault = async (roomID: string) => {
        var roomInfo = await getRoomInfo(roomID);
        if (roomInfo === null) {
            roomInfo = await setRoomInfo(roomID);
        }

        return roomInfo;
    }

    const updateRoomMember = async (roomID: string, member: RoomMember) => {
        await redis.hset(getMembersDBKey(roomID), socket.id, JSON.stringify(member));
    };

    socket.on('join-room', async ({ uid, roomID }: { uid: string, roomID: string }) => {
        const member: RoomMember = { uid: uid, socketID: socket.id, roomID: roomID };
        console.log(`${socket.id} has joined the room with id ${roomID}`);
        socket.join(roomID);
        currentRoomID = roomID;

        Promise.all([getRoomInfoOrSetDefault(roomID), updateRoomMember(roomID, member)]).then(async ([roomInfo, _]) => {
            await redis.publish('member_add', JSON.stringify(member));
            await redis.publish('room_info', JSON.stringify(addReceiverSocketID(roomInfo, socket.id))); // post to current socket only
        });

    });

    socket.on('video-events', async ({ roomID, isPlaying, timestamp }) => {
        console.log(`video-events: ${roomID}, ${isPlaying}, ${timestamp}`);
        const roomInfo = await getRoomInfo(roomID);
        roomInfo.playlist[roomInfo.playingIndex].playedTimestamp = timestamp.toString();
        roomInfo.playlist[roomInfo.playingIndex].lastTimestampUpdatedTime = new Date().getTime().toString();
        roomInfo.playlist[roomInfo.playingIndex].isPlaying = isPlaying;
        await setRoomInfo(roomID, roomInfo);

        await redis.publish('video_events', JSON.stringify({ roomID, ...roomInfo.playlist[roomInfo.playingIndex] }));
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