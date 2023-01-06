import BaseApi from '../lib/baseApi';
import { VideoInfo, VideoPlatform } from '../models/RedisModel';

const YT_API_KEY = process.env.YOUTUBE_DATA_API_KEY;

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

  async searchYoutubeVideos(
    keyword: string,
    maxResults: number = 15
  ): Promise<VideoInfo[]> {
    const videoInfos: VideoInfo[] = [];

    try {
      const requestUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${maxResults}&q=${keyword}&type=video&key=${YT_API_KEY}`;

      const resultList = await this.get(requestUrl);

      const dataList = resultList.items;

      for (const videoData of dataList) {
        const videoInfo: VideoInfo = {
          id: videoData.id.videoId,
          platform: VideoPlatform.YOUTUBE,
          url: `https://youtu.be/${videoData.id.videoId}`,
          title: videoData.snippet.title,
          author: videoData.snippet.channelTitle,
          thumbnailUrl: videoData.snippet.thumbnails.medium.url
        };

        // console.log(videoInfo);

        videoInfos.push(videoInfo);
      }

      return videoInfos;
    } catch (err) {}

    return videoInfos;
  }
}

export default new VideoInfoApi();
