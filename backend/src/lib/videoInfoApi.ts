import BaseApi from '../lib/baseApi';
import { VideoInfo, VideoPlatform } from '../models/RedisModel';
import {
  queryYoutubeTrendingVideosURL,
  queryYoutubeVideoInfoURL,
  queryYoutubeVideoSearchURL
} from './../constants/videos';

class VideoInfoApi extends BaseApi {
  async getYoutubeVideoInfo(videoId: string): Promise<VideoInfo | null> {
    try {
      const requestUrl = queryYoutubeVideoInfoURL(videoId);

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
      const requestUrl = queryYoutubeVideoSearchURL(keyword, maxResults);

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

        videoInfos.push(videoInfo);
      }

      return videoInfos;
    } catch (err) {}

    return videoInfos;
  }

  async getYoutubeTrendingVideos(
    maxResults: number = 15
  ): Promise<VideoInfo[]> {
    const videoInfos: VideoInfo[] = [];

    try {
      const requestUrl = queryYoutubeTrendingVideosURL(maxResults);

      const resultList = await this.get(requestUrl);
      console.log(resultList);
      const dataList = resultList.items;

      for (const videoData of dataList) {
        const videoInfo: VideoInfo = {
          id: videoData.id,
          platform: VideoPlatform.YOUTUBE,
          url: `https://youtu.be/${videoData.id}`,
          title: videoData.snippet.title,
          author: videoData.snippet.channelTitle,
          thumbnailUrl: videoData.snippet.thumbnails.medium.url
        };

        videoInfos.push(videoInfo);
      }

      return videoInfos;
    } catch (err) {}

    return videoInfos;
  }
}

export default new VideoInfoApi();
