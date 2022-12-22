import { Field, ObjectType } from "type-graphql";
import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { RoomInfo } from "../models/RedisModel";
import { User } from "./User";

@ObjectType()
@Entity()
export class Room extends BaseEntity {
    @Field()
    @PrimaryGeneratedColumn("increment")
    id!: string;

    @Field()
    @Column({ default: false })
    isPublic: boolean;

    @Field(() => RoomInfo)
    roomInfo: RoomInfo;

    @Field(() => String)
    @CreateDateColumn()
    createdAt: Date;

    @Field(() => String)
    @UpdateDateColumn()
    updatedAt: Date;

    @Field(() => User)
    @ManyToOne(() => User, (user) => user.createdRooms, {
        cascade: true,
        onDelete: "CASCADE",
    })
    creator!: User;

    @Field(() => [User])
    @ManyToMany(() => User, (users) => users.rooms, {
        cascade: true,
        onDelete: "CASCADE",
    })
    @JoinTable()
    users!: User[];
}
