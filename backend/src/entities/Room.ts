import { Field, ObjectType } from 'type-graphql';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { RoomInfo, RoomMember } from '../models/RedisModel';
import { User } from './User';

@ObjectType()
@Entity()
export class Room extends BaseEntity {
  @Field()
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Field()
  @Column({ default: false })
  isPublic: boolean;

  @Field(() => String)
  @CreateDateColumn()
  createdAt: Date;

  @Field(() => String)
  @UpdateDateColumn()
  updatedAt: Date;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, (user) => user.createdRooms, {
    cascade: true,
    onDelete: 'CASCADE'
  })
  creator: User;

  @Field(() => [User])
  @ManyToMany(() => User, (members) => members.rooms, {
    cascade: true,
    onDelete: 'CASCADE'
  })
  @JoinTable()
  members!: User[];

  // Fetch from redis
  @Field(() => RoomInfo)
  roomInfo: RoomInfo;

  // Fetch from redis
  @Field(() => [RoomMember], { nullable: true })
  activeMembers: RoomMember[];
}
