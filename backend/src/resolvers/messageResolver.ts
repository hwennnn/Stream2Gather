import { Message } from '@src/entities/Message';
import { isAuth } from '@src/middleware/isAuth';
import { FieldError } from '@src/resolvers/types';
import { MyContext } from '@src/types';
import {
  Arg,
  Ctx,
  Field,
  InputType,
  Mutation,
  ObjectType,
  Resolver,
  UseMiddleware
} from 'type-graphql';

@ObjectType()
class MessageResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => Message, { nullable: true })
  message?: Message;
}

@InputType()
class MessageInput {
  @Field()
  content: string;

  @Field()
  roomId: string;
}

@Resolver(Message)
export class MessageResolver {
  @Mutation(() => MessageResponse)
  @UseMiddleware(isAuth)
  async createMessage(
    @Arg('options') options: MessageInput,
    @Ctx() { req }: MyContext
  ): Promise<MessageResponse> {
    const uid = req.session.userId;

    try {
      const message = await Message.create({
        content: options.content,
        room: { id: options.roomId },
        creatorId: uid
      }).save();

      console.log(message);

      return {
        message
      };
    } catch (err) {
      console.error(err);
    }

    return {
      errors: [
        {
          field: 'message',
          message: 'there is an error when creating message'
        }
      ]
    };
  }
}
