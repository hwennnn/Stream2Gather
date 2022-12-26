import { COOKIE_NAME } from "../constants/config";
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
    UseMiddleware,
} from "type-graphql";
import { FieldError } from "./types";
import { verifyFirebaseToken } from "../utils/verifyFirebaseToken";
import { isAuth } from "../middleware/isAuth";
@InputType()
class RegisterInput {
    @Field({ nullable: true })
    email?: string;
    @Field({ nullable: true })
    username?: string;
    @Field()
    token: string;
}

@InputType()
class LoginInput {
    @Field()
    token: string;
}

@InputType()
class UserRelationsInput {
    @Field()
    rooms: boolean = false;
    @Field()
    createdRooms: boolean = false;
}

@ObjectType()
class UserResponse {
    @Field(() => [FieldError], { nullable: true })
    errors?: FieldError[];

    @Field(() => User, { nullable: true })
    user?: User;
}

const formatRelations = (relations: UserRelationsInput) => {
    const formattedRelations = {
        rooms: relations.rooms === true,
        createdRooms: relations.createdRooms === true,
    };

    return formattedRelations;
};

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

    @Query(() => [User])
    async usersWithRelations(
        @Arg("options") options: UserRelationsInput
    ): Promise<User[]> {
        console.log(formatRelations(options));
        return User.find({ relations: formatRelations(options) });
    }

    @Mutation(() => UserResponse)
    async login(
        @Arg("options") options: LoginInput,
        @Ctx() { req }: MyContext
    ): Promise<UserResponse> {
        let user;

        try {
            const uid = await verifyFirebaseToken(options.token);
            user = await User.findOne({
                where: { id: uid },
            });
        } catch (err: any) {
            return {
                errors: [
                    {
                        field: "unknown",
                        message: "invalid token",
                    },
                ],
            };
        }

        if (user === null) {
            return {
                errors: [
                    {
                        field: "unknown",
                        message: "could not find the user",
                    },
                ],
            };
        }

        // store user id session
        // this will set a cookie on the user
        // keep them logged in
        req.session.userId = user?.id;
        return { user };
    }

    @Mutation(() => UserResponse)
    async register(
        @Arg("options") options: RegisterInput,
        @Ctx() { req }: MyContext
    ): Promise<UserResponse> {
        let user;

        try {
            const uid = await verifyFirebaseToken(options.token);
            user = await User.create({
                id: uid,
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

            return {
                errors: [
                    {
                        field: "unknown",
                        message: "error creating user",
                    },
                ],
            };
        }

        // store user id session
        // this will set a cookie on the user
        // keep them logged in
        req.session.userId = user?.id;
        return { user };
    }

    @Mutation(() => UserResponse)
    async socialLogin(
        @Arg("options") options: RegisterInput,
        @Ctx() { req }: MyContext
    ): Promise<UserResponse> {
        let user;

        try {
            const uid = await verifyFirebaseToken(options.token);
            user = await User.findOne({ where: { id: uid } });
            if (user === null) {
                user = await User.create({
                    id: uid,
                    username: options.username,
                    email: options.email,
                }).save();
            }
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

            return {
                errors: [
                    {
                        field: "unknown",
                        message: "error during login",
                    },
                ],
            };
        }

        // store user id session
        // this will set a cookie on the user
        // keep them logged in
        req.session.userId = user?.id;
        return { user };
    }

    @Mutation(() => Boolean)
    @UseMiddleware(isAuth)
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

    // @Mutation(() => Boolean)
    // @UseMiddleware(isAuth)
    // async verifyEmail(@Ctx() { req }: MyContext): Promise<boolean> {
    //     const uid = req.session.userId;
    //     await admin.auth().updateUser(uid!, { emailVerified: true });

    //     return admin
    //         .auth()
    //         .getUser(uid!)
    //         .then((user) => user.emailVerified);
    // }
}
