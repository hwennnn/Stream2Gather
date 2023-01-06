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

@ObjectType()
export class RoomInfo {
  @Field()
  id: string;

  @Field(() => Int)
  playingIndex: number;

  @Field(() => [VideoInfo])
  playlist: VideoInfo[];

  @Field(() => VideoInfo)
  currentVideo: VideoInfo;

  @Field(() => Float)
  playedSeconds: number;

  @Field()
  playedTimestampUpdatedAt: string;

  @Field()
  isPlaying: boolean;
}

export const defaultVideoInfo: VideoInfo = {
  id: 'seJJs-vZBDo',
  platform: VideoPlatform.YOUTUBE,
  title: 'waltuh, put your d away waltuh',
  author: 'Moonatik',
  url: 'https://youtu.be/seJJs-vZBDo',
  thumbnailUrl: 'https://i.ytimg.com/vi/seJJs-vZBDo/mqdefault.jpg'
};

export const defaultRoomInfo: RoomInfo = {
  id: '',
  playingIndex: 0,
  playlist: [defaultVideoInfo],
  currentVideo: defaultVideoInfo,
  playedSeconds: 0.0,
  playedTimestampUpdatedAt: '0',
  isPlaying: true
};
