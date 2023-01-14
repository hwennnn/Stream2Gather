import shortid from 'shortid';
import { RoomInfo, RoomMember } from '../models/RedisModel';
import RedisHelper from './redisHelper';

enum RoomTable {
  ROOM_INFO = 'room_info'
}

interface InvitationCode {
  hash: string;
  createdAt: string;
}

export default class RedisRoomHelper extends RedisHelper {
  public async setRoomInfo(roomId: string, roomInfo: RoomInfo): Promise<void> {
    await this.set<RoomInfo>(RoomTable.ROOM_INFO, roomId, roomInfo);
  }

  public async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
    return await this.get<RoomInfo>(RoomTable.ROOM_INFO, roomId);
  }

  private getMembersTableKey(roomId: string): string {
    return `${roomId}_members`;
  }

  public async getActiveMembers(roomId: string): Promise<RoomMember[]> {
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
    return await this.get<RoomMember>(
      this.getMembersTableKey(roomId),
      socketId
    );
  }

  public async removeRoomMember(
    roomId: string,
    socketId: string
  ): Promise<void> {
    await this.delete(this.getMembersTableKey(roomId), socketId);
  }

  public async getInvitationCode(roomId: string): Promise<string> {
    let result = await this.get<InvitationCode>('invitation_code', roomId);
    const currentTime = new Date().getTime();

    // automatically generate the code every day
    if (
      result === null ||
      currentTime - parseInt(result.createdAt) > 86400000
    ) {
      result = {
        hash: shortid.generate(),
        createdAt: currentTime.toString()
      };
      await this.set<InvitationCode>('invitation_code', roomId, result);
    }

    return result.hash;
  }
}
