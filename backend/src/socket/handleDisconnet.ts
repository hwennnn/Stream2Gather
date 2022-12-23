import { Socket } from "socket.io";
import RedisHelper from "../utils/redisHelper";
import RedisRoomHelper from "../utils/redisRoomHelper";
import { RedisChannel } from "./initRedisSubscribers";

type DisconnetFunction = ({}: {}) => Promise<void>;

export const handleDisconnect = (
    socket: Socket,
    redisHelper: RedisHelper,
    redisRoomHelper: RedisRoomHelper
): DisconnetFunction => {
    return async (): Promise<void> => {
        const currentRoomId = "5";

        console.log(`${socket.id} has left the room with id ${currentRoomId}`);
        const payload = {
            roomId: currentRoomId,
            socketID: socket.id,
        };

        await redisRoomHelper.removeRoomMember(currentRoomId!, socket.id);
        await redisHelper.publish(RedisChannel.MEMBER_LEFT, payload);
    };
};
