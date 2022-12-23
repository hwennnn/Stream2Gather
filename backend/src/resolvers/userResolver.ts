import { COOKIE_NAME } from "../constants/constants";
import { User } from "../entities/User";
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

@InputType()
class UsernameEmailInput {
    @Field()
    email: string;
    @Field()
    username: string;
}

@ObjectType()
class UserResponse {
    @Field(() => [FieldError], { nullable: true })
    errors?: FieldError[];

    @Field(() => User, { nullable: true })
    user?: User;
}

@Resolver(User)
export class UserResolver {
    @FieldResolver(() => String)
    email(@Root() user: User, @Ctx() { req }: MyContext) {
        // this is the current user and its ok to show them their own email
        if (req.session.userId === user.id) {
            return user.email;
        }
        // current user wants to see someone elses email
        return "";
    }

    @Query(() => User, { nullable: true })
    me(@Ctx() { req }: MyContext): Promise<User | null> | null {
        // you are not logged in
        if (!req.session.userId) {
            return null;
        }

        return User.findOne({
            where: { id: req.session.userId },
            relations: { rooms: true, createdRooms: true },
        });
    }

    @Query(() => User, { nullable: true })
    async user(@Arg("id") id: string): Promise<User | null> {
        return User.findOne({ where: { id }, relations: { rooms: true } });
    }

    @Query(() => [User])
    async users(): Promise<User[]> {
        return User.find({ relations: { rooms: true } });
    }

    @Mutation(() => UserResponse)
    async register(
        @Arg("options") options: UsernameEmailInput,
        @Ctx() { req }: MyContext
    ): Promise<UserResponse> {
        let user;

        try {
            user = await User.create({
                username: options.username,
                email: options.email,
            }).save();
            console.log(user);
        } catch (err) {
            if (err.code === "23505") {
                return {
                    errors: [
                        {
                            field: "email",
                            message: "email already taken",
                        },
                    ],
                };
            }
        }

        // store user id session
        // this will set a cookie on the user
        // keep them logged in
        req.session.userId = user?.id;
        return { user };
    }

    @Mutation(() => Boolean)
    logout(@Ctx() { req, res }: MyContext) {
        return new Promise((resolve) =>
            req.session.destroy((err: any) => {
                res.clearCookie(COOKIE_NAME);
                if (err) {
                    console.log(err);
                    resolve(false);
                    return;
                }

                resolve(true);
            })
        );
    }
}
