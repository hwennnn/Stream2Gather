import videoInfoApi from '@src/lib/videoInfoApi';
import { VideoInfo } from '@src/models/RedisModel';
import { Arg, Query, Resolver } from 'type-graphql';

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

  @Query(() => [VideoInfo])
  async youtubeTrendingVideos(): Promise<VideoInfo[]> {
    try {
      const result = await videoInfoApi.getYoutubeTrendingVideos();

      return result;
    } catch (err) {
      console.log(err);
    }

    return [];
  }
}
