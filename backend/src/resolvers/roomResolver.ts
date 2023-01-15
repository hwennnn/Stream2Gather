import { Message } from '@src/entities/Message';
import { Room } from '@src/entities/Room';
import { User } from '@src/entities/User';
import { isAuth } from '@src/middleware/isAuth';
import { defaultRoomInfo, RoomInfo, RoomMember } from '@src/models/RedisModel';
import { FieldError } from '@src/resolvers/types';
import { MyContext } from '@src/types';
import { generateSlug } from 'random-word-slugs';
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
  UseMiddleware
} from 'type-graphql';

@ObjectType()
class RoomResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => Room, { nullable: true })
  room?: Room;
}

@Resolver(Room)
export class RoomResolver {
  @FieldResolver(() => RoomInfo)
  async roomInfo(
    @Root() room: Room,
    @Ctx() { redisRoomHelper }: MyContext
  ): Promise<RoomInfo> {
    const resultFromRedis = await redisRoomHelper.getRoomInfo(room.id);

    return resultFromRedis ?? defaultRoomInfo;
  }

  @FieldResolver(() => [RoomMember])
  async activeMembers(
    @Root() room: Room,
    @Ctx() { redisRoomHelper }: MyContext
  ): Promise<RoomMember[]> {
    return await redisRoomHelper.getActiveMembers(room.id);
  }

  @FieldResolver(() => String, { nullable: true })
  async invitationCode(
    @Root() room: Room,
    @Ctx() { redisRoomHelper }: MyContext
  ): Promise<string | null> {
    if (room.isPublic) return null;

    return await redisRoomHelper.getInvitationCode(room.id);
  }

  @Query(() => Room, { nullable: true })
  async room(@Arg('slug') slug: string): Promise<Room | null> {
    try {
      return await Room.findOne({
        where: { slug },
        relations: {
          members: true
        }
      });
    } catch (err) {
      console.log(err);
    }

    return null;
  }

  @Query(() => [Message], { nullable: true })
  async roomMessages(
    @Arg('slug') slug: string
  ): Promise<Message[] | undefined> {
    try {
      const room = await Room.findOne({
        where: { slug },
        relations: {
          messages: true
        },
        order: {
          messages: {
            createdAt: 'ASC'
          }
        }
      });

      return room?.messages;
    } catch (err) {
      console.log(err);
    }

    return undefined;
  }

  @Query(() => [Room])
  async rooms(): Promise<Room[]> {
    return await Room.find({ relations: { members: true, creator: true } });
  }

  @Mutation(() => RoomResponse)
  @UseMiddleware(isAuth)
  async createRoom(
    @Ctx() { req, redisRoomHelper }: MyContext
  ): Promise<RoomResponse> {
    const uid: string = req.session.userId as string;
    const user = await User.findOne({ where: { id: uid } });
    let slug = generateSlug();
    let foundRoom = null;

    do {
      foundRoom = await Room.findOne({ where: { slug } });
      if (foundRoom !== null) {
        slug = generateSlug();
      }
    } while (foundRoom !== null);

    if (user !== null) {
      const room = await Room.create({
        slug,
        creator: user,
        members: [user]
      }).save();

      const roomInfo: RoomInfo = defaultRoomInfo;
      roomInfo.id = room.id;

      await redisRoomHelper.setRoomInfo(room.id, roomInfo);

      return { room };
    }

    return {
      errors: [
        {
          field: 'room',
          message: 'there is an error when creating room'
        }
      ]
    };
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async deleteRoom(@Arg('id') id: string): Promise<boolean> {
    try {
      await Room.delete({ id });
    } catch (err) {
      console.error(err);
      return false;
    }

    return true;
  }
}
