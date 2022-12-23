import { Socket } from "socket.io";
import { RES_MEMBER_LEFT } from "../constants/socket";
import RedisHelper from "../utils/redisHelper";
import RedisRoomHelper from "../utils/redisRoomHelper";

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
        await redisHelper.publish(RES_MEMBER_LEFT, payload);
    };
};
