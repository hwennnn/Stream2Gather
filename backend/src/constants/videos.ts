const YT_API_KEY = process.env.YOUTUBE_DATA_API_KEY;

export const queryYoutubeVideoInfoURL = (videoId: string): string =>
  `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YT_API_KEY}`;

export const queryYoutubeVideoSearchURL = (
  keyword: string,
  maxResults: number
): string =>
  `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${maxResults}&q=${keyword}&type=video&key=${YT_API_KEY}`;

export const queryYoutubeTrendingVideosURL = (
  maxResults: number,
  region: string = 'US'
): string =>
  `https://www.googleapis.com/youtube/v3/videos?part=snippet%2CcontentDetails%2Cstatistics&chart=mostPopular&maxResults=${maxResults}&regionCode=${region}&key=${YT_API_KEY}`;
