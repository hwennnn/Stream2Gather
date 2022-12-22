import { DEFAULT_VIDEO_URL } from "../constants";
import { ObjectType, Field } from "type-graphql";
import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { User } from "./User";
import { rootCertificates } from "tls";

@ObjectType()
@Entity()
export class Room extends BaseEntity {
    @Field()
    @PrimaryGeneratedColumn("increment")
    id!: string;

    @Field()
    @Column({ default: false })
    isPublic: boolean;

    @Field()
    @Column({ default: DEFAULT_VIDEO_URL })
    currentUrl: string;

    @Field()
    @Column({ default: 0 })
    playingIndex: number;

    @Field()
    @Column({ default: 0 })
    playedTimestamp: number;

    @Field()
    @Column({ default: new Date().getTime().toString() })
    lastTimestampUpdatedTime!: string;

    @Field()
    @Column({ default: true })
    isPlaying: boolean;

    @Field(() => String)
    @CreateDateColumn()
    createdAt: Date;

    @Field(() => String)
    @UpdateDateColumn()
    updatedAt: Date;

    @Field(() => User)
    @ManyToOne(() => User, (user) => user.createdRooms, {
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
