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
import { defaultRoomInfo, RoomInfo } from "./../models/RedisModel";
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
    async roomInfo(@Root() room: Room, @Ctx() { redis }: MyContext) {
        var roomInfo = (await redis.hget("room_info", room.id)) as string;
        return JSON.parse(roomInfo);
    }

    @Query(() => Room, { nullable: true })
    async room(@Arg("id") id: string): Promise<Room | null> {
        try {
            return Room.findOne({
                where: { id },
                relations: { users: true, creator: true },
            });
        } catch (err) {
            console.log(err);
        }

        return null;
    }

    @Query(() => [Room])
    async rooms(): Promise<Room[]> {
        return Room.find({ relations: { users: true, creator: true } });
    }

    @Mutation(() => RoomResponse)
    async createRoom(@Ctx() { req, redis }: MyContext): Promise<RoomResponse> {
        const uid: string = req.session.userId!;
        const user = await User.findOne({ where: { id: uid } });

        if (user !== null) {
            let room = await Room.create({
                creator: user,
                users: [user],
            }).save();

            const roomInfo: RoomInfo = defaultRoomInfo;
            roomInfo.id = room.id;

            await redis.hset("room_info", room.id, JSON.stringify(roomInfo));

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
