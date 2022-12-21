import { COOKIE_NAME } from "./../constants";
import { Room } from "../entity/Room";
import { MyContext } from "../types";
import {
    Resolver,
    Query,
    Ctx,
    Arg,
    InputType,
    Mutation,
    Field,
    ObjectType,
    FieldResolver,
    Root,
} from "type-graphql";
import { FieldError } from "./types";
import { User } from "../entity/User";

@ObjectType()
class RoomResponse {
    @Field(() => [FieldError], { nullable: true })
    errors?: FieldError[];

    @Field(() => Room, { nullable: true })
    room?: Room;
}

@Resolver(Room)
export class RoomResolver {
    @Query(() => Room, { nullable: true })
    async room(@Arg("id") id: string): Promise<Room | null> {
        return Room.findOne({
            where: { id },
            relations: { users: true },
        });
    }

    @Query(() => [Room])
    async rooms(): Promise<Room[]> {
        return Room.find({ relations: { users: true } });
    }

    @Mutation(() => RoomResponse)
    async createRoom(@Ctx() { req }: MyContext): Promise<RoomResponse> {
        const uid: string = req.session.userId!;
        const user = await User.findOne({ where: { id: uid } });

        if (user !== null) {
            let room = await Room.create({
                // creator: user,
                users: [user],
            }).save();

            console.log("roomCreated", room);

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
}
