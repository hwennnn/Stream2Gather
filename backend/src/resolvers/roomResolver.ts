import {
    Arg,
    Ctx,
    Field,
    FieldResolver,
    Mutation,
    ObjectType,
    Query,
    Resolver,
    Root,
} from "type-graphql";
import { Room } from "../entities/Room";
import { User } from "../entities/User";
import { MyContext } from "../types";
import { defaultRoomInfo, RoomInfo, RoomMember } from "./../models/RedisModel";
import { FieldError } from "./types";

@ObjectType()
class RoomResponse {
    @Field(() => [FieldError], { nullable: true })
    errors?: FieldError[];

    @Field(() => Room, { nullable: true })
    room?: Room;
}

@Resolver(Room)
export class RoomResolver {
    @FieldResolver(() => RoomInfo, { nullable: true })
    async roomInfo(@Root() room: Room, @Ctx() { redisRoomHelper }: MyContext) {
        return await redisRoomHelper.getRoomInfo(room.id);
    }

    @FieldResolver(() => [RoomMember], { nullable: true })
    async activeMembers(
        @Root() room: Room,
        @Ctx() { redisRoomHelper }: MyContext
    ) {
        return await redisRoomHelper.getActiveMembers(room.id);
    }

    @Query(() => Room, { nullable: true })
    async room(@Arg("id") id: string): Promise<Room | null> {
        try {
            return Room.findOne({
                where: { id },
                relations: { members: true, creator: true },
            });
        } catch (err) {
            console.log(err);
        }

        return null;
    }

    @Query(() => [Room])
    async rooms(): Promise<Room[]> {
        return Room.find({ relations: { members: true, creator: true } });
    }

    @Mutation(() => RoomResponse)
    async createRoom(
        @Ctx() { req, redisRoomHelper }: MyContext
    ): Promise<RoomResponse> {
        const uid: string = req.session.userId!;
        const user = await User.findOne({ where: { id: uid } });

        if (user !== null) {
            let room = await Room.create({
                creator: user,
                members: [user],
            }).save();

            const roomInfo: RoomInfo = defaultRoomInfo;
            roomInfo.id = room.id;

            await redisRoomHelper.setRoomInfo(room.id, roomInfo);

            return { room };
        }

        return {
            errors: [
                {
                    field: "room",
                    message: "there is an error when creating room",
                },
            ],
        };
    }

    @Mutation(() => Boolean)
    async deleteRoom(@Arg("id") id: string): Promise<boolean> {
        try {
            await Room.delete({ id });
        } catch (err) {
            console.error(err);
            return false;
        }

        return true;
    }
}
