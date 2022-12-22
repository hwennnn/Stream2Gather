import { IncomingMessage, Server, ServerResponse } from "http";
import { Server as SocketServer } from "socket.io";
import Redis from "ioredis";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import RedisRoomHelper from "../utils/redisRoomHelper";
import { RoomMember } from "./RedisModel";

enum RedisChannel {
    MESSAGE = "messages",
    NEW_MEMBER = "new_member",
    MEMBER_LEFT = "member_left",
    ROOM_INFO = "room_info",
    STREAMING_EVENTS = "streaming_events",
}

export default class CustomSocket {
    private io: SocketServer<
        DefaultEventsMap,
        DefaultEventsMap,
        DefaultEventsMap,
        any
    >;
    private redis: Redis;
    private redisSubscribers: Map<String, Redis>;
    private roomRedisHelper: RedisRoomHelper;

    constructor(
        httpServer: Server<typeof IncomingMessage, typeof ServerResponse>,
        redis: Redis
    ) {
        this.io = new SocketServer(httpServer, {
            cors: {
                origin: process.env.CORS_ORIGIN,
                methods: ["GET", "POST"],
            },
        });
        this.redis = redis;
    }

    init(): void {
        this.roomRedisHelper = new RedisRoomHelper(this.redis);
        this.redisSubscribers = this.initRedisSubscribers();
        this.initSocketConnection();
    }

    private addRedisSubscriber(subscriber_key: string): Redis {
        let client = new Redis(process.env.REDIS_ADDRESS as string);

        client.subscribe(subscriber_key);
        client.on("message", (channel, message) => {
            const { roomId, receiverSocketId } = JSON.parse(message);
            if (receiverSocketId !== undefined && receiverSocketId !== null) {
                this.io.to(receiverSocketId).emit(subscriber_key, message);
            } else if (roomId !== undefined && roomId !== null) {
                this.io.to(roomId).emit(subscriber_key, message);
            }
        });

        return client;
    }

    private initRedisSubscribers(): Map<String, Redis> {
        let redisSubscribers = new Map<String, Redis>();
        const channels = Object.values(RedisChannel);

        for (const channel of channels) {
            redisSubscribers.set(channel, this.addRedisSubscriber(channel));
        }

        return redisSubscribers;
    }

    private specifyReceiverSocketId(message: any, receiverSocketId: string) {
        message.receiverSocketId = receiverSocketId;
        return message;
    }

    private initSocketConnection(): void {
        this.io.on("connection", (socket) => {
            // cache the current room id on the socket (scoped)
            let currentRoomId: string | null = null;
            // console.log("New client connected", socket.id);
            // socket.emit("Welcome to stream2gather. " + socket.id);

            socket.on(
                "join-room",
                async ({ uid, roomId }: { uid: string; roomId: string }) => {
                    const member: RoomMember = {
                        uid: uid,
                        socketId: socket.id,
                        roomId: roomId,
                    };
                    console.log(
                        `${socket.id} has joined the room with id ${roomId}`
                    );

                    socket.join(roomId);
                    currentRoomId = roomId;

                    Promise.all([
                        this.roomRedisHelper.getRoomInfo(roomId),
                        this.roomRedisHelper.updateRoomMember(
                            roomId,
                            socket.id,
                            member
                        ),
                    ]).then(async ([roomInfo, _]) => {
                        await this.redis.publish(
                            RedisChannel.NEW_MEMBER,
                            JSON.stringify(member)
                        );

                        // post to current socket only
                        await this.redis.publish(
                            RedisChannel.ROOM_INFO,
                            JSON.stringify(
                                this.specifyReceiverSocketId(
                                    roomInfo,
                                    socket.id
                                )
                            )
                        );
                    });
                }
            );

            socket.on(
                "video-events",
                async ({ roomId, isPlaying, timestamp }) => {
                    console.log(
                        `video-events: ${roomId}, ${isPlaying}, ${timestamp}`
                    );
                    const roomInfo = (await this.roomRedisHelper.getRoomInfo(
                        roomId
                    ))!;

                    roomInfo.playedSeconds = timestamp;
                    roomInfo.playedTimestampUpdatedAt = new Date()
                        .getTime()
                        .toString();
                    roomInfo.isPlaying = isPlaying;

                    const payload = {
                        roomId,
                        playedSeconds: roomInfo.playedSeconds,
                        playedTimestampUpdatedAt:
                            roomInfo.playedTimestampUpdatedAt,
                        isPlaying: roomInfo.isPlaying,
                    };

                    await this.roomRedisHelper.setRoomInfo(roomId, roomInfo);

                    await this.redis.publish(
                        RedisChannel.STREAMING_EVENTS,
                        JSON.stringify({ payload })
                    );
                }
            );

            // Runs when client disconnects
            socket.on("disconnect", async () => {
                console.log(
                    `${socket.id} has left the room with id ${currentRoomId}`
                );
                const payload = {
                    roomId: currentRoomId,
                    socketID: socket.id,
                };

                await this.roomRedisHelper.removeRoomMember(
                    currentRoomId!,
                    socket.id
                );
                await this.redis.publish(
                    RedisChannel.MEMBER_LEFT,
                    JSON.stringify(payload)
                );
            });
        });
    }
}
