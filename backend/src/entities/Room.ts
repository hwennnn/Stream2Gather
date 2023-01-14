import { Field, ObjectType } from 'type-graphql';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Message } from '../entities/Message';
import { RoomInfo, RoomMember } from '../models/RedisModel';
import { User } from './User';

@ObjectType()
@Entity()
export class Room extends BaseEntity {
  @Field()
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Field()
  @Column({ unique: true })
  slug!: string;

  @Field()
  @Column({ default: true })
  isActive: boolean;

  @Field()
  @Column({ default: true })
  isTemporary: boolean;

  @Field()
  @Column({ default: false })
  isPublic: boolean;

  @Field({ nullable: true })
  invitationCode: string;

  @Field(() => String)
  @CreateDateColumn()
  createdAt: Date;

  @Field(() => String)
  @UpdateDateColumn()
  updatedAt: Date;

  @Field(() => String)
  @Column()
  creatorId!: string;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, (user) => user.createdRooms, {
    cascade: true,
    onDelete: 'CASCADE'
  })
  creator!: User;

  // historical members
  @Field(() => [User], { nullable: true })
  @ManyToMany(() => User, (members) => members.rooms, {
    cascade: true,
    onDelete: 'CASCADE'
  })
  @JoinTable()
  members!: User[];

  // uid list of banned users
  @Field(() => [String])
  @Column('text', { array: true, default: [] })
  bannedUsers!: string[];

  // Fetch from redis
  @Field(() => RoomInfo)
  roomInfo: RoomInfo;

  // Fetch from redis
  @Field(() => [RoomMember])
  activeMembers: RoomMember[];

  @Field(() => [Message], { nullable: true })
  @OneToMany(() => Message, (message) => message.room)
  messages!: Message[];
}
