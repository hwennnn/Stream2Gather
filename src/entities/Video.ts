import { ObjectType, Field } from "type-graphql";
import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";

enum Platform {
    YOUTUBE = "YOUTUBE",
    TWITCH = "TWITCH",
    DAILYMOTION = "DAILYMOTION",
}

@ObjectType()
@Entity()
export class Video extends BaseEntity {
    @Field()
    @PrimaryColumn()
    id!: string;

    @Field(() => Platform)
    @PrimaryColumn()
    platform!: Platform;

    @Field()
    @Column()
    url!: string;

    @Field()
    @Column()
    thumbnailUrl!: string;

    @Field()
    @Column()
    title!: string;

    @Field()
    @Column()
    author!: string;

    @Field(() => String)
    @CreateDateColumn()
    createdAt: Date;

    @Field(() => String)
    @UpdateDateColumn()
    updatedAt: Date;
}
