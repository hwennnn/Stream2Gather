import { Arg, Query, Resolver } from 'type-graphql';
import videoInfoApi from '../lib/videoInfoApi';
import { VideoInfo } from './../models/RedisModel';

@Resolver(VideoInfo)
export class VideoInfoResolver {
  @Query(() => VideoInfo, { nullable: true })
  async youtubeVideoInfo(
    @Arg('videoId') videoId: string
  ): Promise<VideoInfo | null> {
    try {
      const result = await videoInfoApi.getYoutubeVideoInfo(videoId);

      return result;
    } catch (err) {
      console.log(err);
    }

    return null;
  }

  @Query(() => [VideoInfo])
  async youtubeVideos(@Arg('keyword') keyword: string): Promise<VideoInfo[]> {
    try {
      const result = await videoInfoApi.searchYoutubeVideos(keyword);

      return result;
    } catch (err) {
      console.log(err);
    }

    return [];
  }
}
