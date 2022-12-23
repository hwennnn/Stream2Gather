import { Socket } from "socket.io";
import { RoomMember } from "../models/RedisModel";
import RedisHelper from "../utils/redisHelper";
import RedisRoomHelper from "../utils/redisRoomHelper";
import { RedisChannel } from "./initRedisSubscribers";

type JoinRoomFunction = ({
    uid,
    roomId,
}: {
    uid: string;
    roomId: string;
}) => Promise<void>;

export const handleJoinRoom = (
    socket: Socket,
    redisHelper: RedisHelper,
    redisRoomHelper: RedisRoomHelper
): JoinRoomFunction => {
    return async ({ uid, roomId }): Promise<void> => {
        const member: RoomMember = {
            uid: uid,
            socketId: socket.id,
            roomId: roomId,
        };
        console.log(`${socket.id} has joined the room with id ${roomId}`);

        socket.join(roomId);
        // currentRoomId = roomId;

        Promise.all([
            redisRoomHelper.getRoomInfo(roomId),
            redisRoomHelper.updateRoomMember(roomId, socket.id, member),
        ]).then(async ([roomInfo, _]) => {
            console.log("roomInfo", roomInfo);

            await redisHelper.publish(RedisChannel.NEW_MEMBER, member);

            // post to current socket only
            await redisHelper.publish(
                RedisChannel.ROOM_INFO,
                roomInfo,
                socket.id
            );
        });
    };
};
