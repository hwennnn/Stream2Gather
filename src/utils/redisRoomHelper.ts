import Redis from "ioredis";
import { RoomInfo, RoomMember } from "src/models/RedisModel";
import RedisHelper from "./redisHelper";

enum RoomTable {
    ROOM_INFO = "room_info",
}

export default class RedisRoomHelper extends RedisHelper {
    constructor(redis: Redis) {
        super(redis);
    }

    public async setRoomInfo(
        roomId: string,
        roomInfo: RoomInfo
    ): Promise<void> {
        await this.set<RoomInfo>(RoomTable.ROOM_INFO, roomId, roomInfo);
    }

    public async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
        return await this.get<RoomInfo>(RoomTable.ROOM_INFO, roomId);
    }

    private getMembersTableKey(roomId: string): string {
        return `${roomId}_members`;
    }

    public async getRoomMembers(roomId: string): Promise<RoomMember[]> {
        return await this.hgetall<RoomMember>(this.getMembersTableKey(roomId));
    }

    public async updateRoomMember(
        roomId: string,
        socketId: string,
        member: RoomMember
    ): Promise<void> {
        await this.set<RoomMember>(
            this.getMembersTableKey(roomId),
            socketId,
            member
        );
    }

    public async getMember(
        roomId: string,
        socketId: string
    ): Promise<RoomMember | null> {
        return await this.get(this.getMembersTableKey(roomId), socketId);
    }

    public async removeRoomMember(
        roomId: string,
        socketId: string
    ): Promise<void> {
        await this.delete(this.getMembersTableKey(roomId), socketId);
    }
}
