import { User } from '@src/entities/User';
import { RoomInfo, RoomMember } from '@src/models/RedisModel';
import { Field, ObjectType } from 'type-graphql';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

@ObjectType()
@Entity()
export class Room extends BaseEntity {
  @Field()
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Field()
  @PrimaryColumn()
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
  creator!: User;

  // historical members
  @Field(() => [User], { nullable: true })
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
  @Field(() => [RoomMember])
  activeMembers: RoomMember[];
}
