import { Field, ObjectType } from "type-graphql";
import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    ManyToMany,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Room } from "./Room";

@ObjectType()
@Entity()
export class User extends BaseEntity {
    @Field()
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Field()
    @Column()
    username!: string;

    @Field()
    @Column({ unique: true })
    email!: string;

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
