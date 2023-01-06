import BaseApi from '../lib/baseApi';
import { VideoInfo, VideoPlatform } from '../models/RedisModel';

const YT_API_KEY = process.env.YOUTUBE_DATA_API_KEY as string;

class VideoInfoApi extends BaseApi {
  async getYoutubeVideoInfo(videoId: string): Promise<VideoInfo | null> {
    try {
      const requestUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YT_API_KEY}`;

      const result = await this.get(requestUrl);
      const data = result.items[0].snippet;

      const videoInfo: VideoInfo = {
        id: videoId,
        platform: VideoPlatform.YOUTUBE,
        url: `https://youtu.be/${videoId}`,
        title: data.title,
        author: data.channelTitle,
        thumbnailUrl: data.thumbnails.medium.url
      };

      console.log(videoInfo);

      return videoInfo;
    } catch (err) {}

    return null;
  }
}

export default new VideoInfoApi();
