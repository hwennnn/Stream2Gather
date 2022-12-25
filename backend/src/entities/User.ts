import { Field, ObjectType } from "type-graphql";
import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    ManyToMany,
    OneToMany,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Room } from "./Room";

@ObjectType()
@Entity()
export class User extends BaseEntity {
    @Field()
    @PrimaryColumn()
    id!: string;

    @Field()
    @Column()
    username!: string;

    @Field()
    @Column()
    email: string;

    @Field(() => String)
    @CreateDateColumn()
    createdAt: Date;

    @Field(() => String)
    @UpdateDateColumn()
    updatedAt: Date;

    @Field(() => [Room], { nullable: true })
    @ManyToMany(() => Room, (rooms) => rooms.members)
    rooms: Room[];

    @Field(() => [Room], { nullable: true })
    @OneToMany(() => Room, (room) => room.creator)
    createdRooms: Room[];
}
