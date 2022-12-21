import { COOKIE_NAME } from './../constants';
import { User } from "../entity/User";
import { MyContext } from "../types";
import { Resolver, Query, Ctx, Arg, InputType, Mutation, Field, ObjectType } from "type-graphql";

@InputType()
class UsernameEmailInput {
  @Field()
  email: string;
  @Field()
  username: string;
}

@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
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
  @Query(() => User, { nullable: true })
  me(
    @Ctx() { req }: MyContext,
  ): Promise<User | null> | null {
    console.log("session", req.session.userId);
    // you are not logged in
    if (!req.session.userId) {
      return null;
    }

    return User.findOne({ where: { id: req.session.userId } });
  }

  @Query(() => User, { nullable: true })
  async user(
    @Arg("id") id: string,
  ): Promise<User | null> {
    return User.findOne({ where: { id } });
  }

  @Query(() => [User])
  async users(): Promise<User[]> {
    return User.find();
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: UsernameEmailInput,
    @Ctx() { req }: MyContext,
  ): Promise<UserResponse> {

    let user;

    try {
      user = await User.create(
        {
          username: options.username,
          email: options.email,
        }
      ).save();
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
    console.log("stored session", req.session.userId);
    req.session.userId = user?.id;
    console.log("stored session", req.session.userId);
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
