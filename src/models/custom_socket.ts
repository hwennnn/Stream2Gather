import { IncomingMessage, Server, ServerResponse } from "http";
import { Server as SocketServer } from "socket.io";
import Redis from "ioredis";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import { RoomInfo, RoomMember, VideoInfo } from "./rooms";

export default class CustomSocket {
    private io: SocketServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;
    private redis: Redis;
    private redisSubscribers: Map<String, Redis>;

    constructor(httpServer: Server<typeof IncomingMessage, typeof ServerResponse>, redis: Redis) {
        this.io = new SocketServer(httpServer, {
            cors: {
                origin: process.env.CORS_ORIGIN,
                methods: ["GET", "POST"]
            }
        });
        this.redis = redis;
        this.redisSubscribers = this.initRedisSubscribers();
        this.initConnection();
    }

    private addRedisSubscriber(subscriber_key: string): Redis {
        var client = new Redis(process.env.REDIS_ADDRESS as string);

        client.subscribe(subscriber_key);
        client.on('message', (channel, message) => {
            message = JSON.parse(message);
            const { roomID, receiverSocketID } = message;
            if (receiverSocketID !== undefined && receiverSocketID !== null) {
                this.io.to(receiverSocketID).emit(subscriber_key, message);
            }
            else if (roomID !== undefined && roomID !== null) {
                this.io.to(roomID).emit(subscriber_key, message);
            }
        });

        return client;
    }

    private initRedisSubscribers(): Map<String, Redis> {
        var redisSubscribers = new Map<String, Redis>();
        const channels = ['messages', 'member_add', 'member_left', "room_info", "video_events"];

        for (const channel of channels) {
            redisSubscribers.set(channel, this.addRedisSubscriber(channel));
        }

        return redisSubscribers;
    }

    private async getRoomInfo(roomID: string): Promise<RoomInfo> {
        var roomInfo = await this.redis.hget("room_info", roomID) as string;
        return JSON.parse(roomInfo);
    }

    private async setRoomInfo(roomID: string, roomInfo?: any): Promise<RoomInfo> {
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
        await this.redis.hset("room_info", roomID, JSON.stringify(roomInfo));

        return roomInfo;
    }

    private addReceiverSocketID(message: any, receiverSocketID: string) {
        message.receiverSocketID = receiverSocketID;
        return message;
    };

    private getMembersDBKey(roomID: string): string {
        return `${roomID}_members`;
    }

    // // async function getMembers(roomID: string) {
    // //     var redis_members = await redis.hgetall(getMembersDBKey(roomID));
    // //     let members = new Map<String, String>();
    // //     for (var key in redis_members) {
    // //         members.set(key, JSON.parse(redis_members[key]));
    // //     }
    // //     return members;
    // // }

    // // async function getMember(socketID: string) {
    // //     let member : string | null = await redis.hget('members', socketID);
    // //     if (member === null) {return null};
    // //     return JSON.parse(member);
    // // }

    private initConnection(): void {
        this.io.on("connection", (socket) => {
            // cache the current room id on the socket (scoped)
            let currentRoomID: string | null = null;
            // console.log("New client connected", socket.id);
            // socket.emit("Welcome to stream2gather. " + socket.id);

            const getRoomInfoOrSetDefault = async (roomID: string) => {
                var roomInfo = await this.getRoomInfo(roomID);
                if (roomInfo === null) {
                    roomInfo = await this.setRoomInfo(roomID);
                }

                return roomInfo;
            }

            const updateRoomMember = async (roomID: string, member: RoomMember) => {
                await this.redis.hset(this.getMembersDBKey(roomID), socket.id, JSON.stringify(member));
            };

            socket.on('join-room', async ({ uid, roomID }: { uid: string, roomID: string }) => {
                const member: RoomMember = { uid: uid, socketID: socket.id, roomID: roomID };
                console.log(`${socket.id} has joined the room with id ${roomID}`);
                socket.join(roomID);
                currentRoomID = roomID;

                Promise.all([getRoomInfoOrSetDefault(roomID), updateRoomMember(roomID, member)]).then(async ([roomInfo, _]) => {
                    await this.redis.publish('member_add', JSON.stringify(member));
                    await this.redis.publish('room_info', JSON.stringify(this.addReceiverSocketID(roomInfo, socket.id))); // post to current socket only
                });

            });

            socket.on('video-events', async ({ roomID, isPlaying, timestamp }) => {
                console.log(`video-events: ${roomID}, ${isPlaying}, ${timestamp}`);
                const roomInfo = await this.getRoomInfo(roomID);
                roomInfo.playlist[roomInfo.playingIndex].playedTimestamp = timestamp.toString();
                roomInfo.playlist[roomInfo.playingIndex].lastTimestampUpdatedTime = new Date().getTime().toString();
                roomInfo.playlist[roomInfo.playingIndex].isPlaying = isPlaying;
                await this.setRoomInfo(roomID, roomInfo);

                await this.redis.publish('video_events', JSON.stringify({ roomID, ...roomInfo.playlist[roomInfo.playingIndex] }));
            });


            // Runs when client disconnects
            socket.on('disconnect', async () => {
                console.log(`${socket.id} has left the room with id ${currentRoomID}`);
                const payload = {
                    roomID: currentRoomID,
                    socketID: socket.id,
                };
                await this.redis.hdel(this.getMembersDBKey(currentRoomID!), socket.id);
                await this.redis.publish('member_left', JSON.stringify(payload));
            });
        });
    }
}