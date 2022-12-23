import { RES_STREAMING_EVENTS } from "./../constants/socket";
import RedisHelper from "../utils/redisHelper";
import RedisRoomHelper from "../utils/redisRoomHelper";

type StreamRoomFunction = ({
    roomId,
    isPlaying,
    timestamp,
}: {
    roomId: string;
    isPlaying: boolean;
    timestamp: number;
}) => Promise<void>;

export const handleStreamingEvents = (
    redisHelper: RedisHelper,
    redisRoomHelper: RedisRoomHelper
): StreamRoomFunction => {
    return async ({ roomId, isPlaying, timestamp }): Promise<void> => {
        console.log(`video-events: ${roomId}, ${isPlaying}, ${timestamp}`);
        const roomInfo = (await redisRoomHelper.getRoomInfo(roomId))!;

        roomInfo.playedSeconds = timestamp;
        roomInfo.playedTimestampUpdatedAt = new Date().getTime().toString();
        roomInfo.isPlaying = isPlaying;

        const payload = {
            roomId,
            playedSeconds: roomInfo.playedSeconds,
            playedTimestampUpdatedAt: roomInfo.playedTimestampUpdatedAt,
            isPlaying: roomInfo.isPlaying,
        };

        await redisRoomHelper.setRoomInfo(roomId, roomInfo);

        await redisHelper.publish(RES_STREAMING_EVENTS, payload);
    };
};
