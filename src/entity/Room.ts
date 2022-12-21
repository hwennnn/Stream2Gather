import { ObjectType, Field } from "type-graphql";
import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

@ObjectType()
@Entity()
export class Room extends BaseEntity {
    @Field()
    @PrimaryGeneratedColumn("increment")
    id!: string;

    @Field()
    @Column()
    currentUrl!: string;

    @Field()
    @Column()
    playingIndex!: number;

    @Field()
    @Column()
    playedTimestamp!: number;

    @Field()
    @Column()
    lastTimestampUpdatedTime!: number;

    @Field()
    @Column()
    isPlaying!: boolean;

    @Field(() => String)
    @CreateDateColumn()
    createdAt: Date;

    @Field(() => String)
    @UpdateDateColumn()
    updatedAt: Date;
}
