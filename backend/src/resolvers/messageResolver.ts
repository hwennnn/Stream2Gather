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
import { Message } from '../entities/Message';
import { isAuth } from '../middleware/isAuth';
import { FieldError } from '../resolvers/types';
import { MyContext } from '../types';

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
