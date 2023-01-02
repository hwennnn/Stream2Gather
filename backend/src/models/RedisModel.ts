import { Field, Float, Int, ObjectType } from 'type-graphql';

export enum VideoPlatform {
  YOUTUBE = 'YOUTUBE',
  TWITCH = 'TWITCH',
  DAILYMOTION = 'DAILYMOTION'
}

@ObjectType()
export class RoomMember {
  @Field()
  uid: string;

  @Field()
  username: string;

  @Field()
  socketId: string;

  @Field()
  roomId: string;
}

@ObjectType()
export class RoomInfo {
  @Field()
  id: string;

  @Field()
  currentUrl: string;

  @Field(() => Int)
  playingIndex: number;

  @Field(() => Float)
  playedSeconds: number;

  @Field()
  playedTimestampUpdatedAt: string;

  @Field()
  isPlaying: boolean;

  @Field(() => [VideoInfo])
  playlist: VideoInfo[];
}

@ObjectType()
export class VideoInfo {
  @Field(() => String)
  platform: VideoPlatform;

  @Field()
  id: string;

  @Field()
  url: string;

  @Field()
  thumbnailUrl: string;

  @Field()
  title: string;

  @Field()
  author: string;
}

export const defaultVideoInfo: VideoInfo = {
  platform: VideoPlatform.YOUTUBE,
  id: 'Y8JFxS1HlDo',
  url: 'https://youtu.be/Y8JFxS1HlDo',
  thumbnailUrl: '',
  title: '',
  author: ''
};

export const defaultRoomInfo: RoomInfo = {
  id: '',
  currentUrl: defaultVideoInfo.url,
  playingIndex: 0,
  playedSeconds: 0.0,
  playedTimestampUpdatedAt: '0',
  isPlaying: true,
  playlist: [defaultVideoInfo]
};
