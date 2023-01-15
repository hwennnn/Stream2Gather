import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { QueryVideoCard } from '@app/components/rooms/QueryVideoCard';
import {
  useYoutubeTrendingVideosQuery,
  VideoInfo
} from '@app/generated/graphql';
import { addToPlayList, playNewVideo } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import { Button, SimpleGrid, VStack } from '@chakra-ui/react';
import { FC, useEffect, useState } from 'react';

const showLimit = 9;

export const TrendingVideosSection: FC = () => {
  const { socket } = useRoomContext();
  const [fetchedVideos, setFetchedVideos] = useState<VideoInfo[]>([]);
  const [showMore, setShowMore] = useState(false);

  const [trendingVideos, setTrendingVideos] = useState<VideoInfo[]>([]);

  const { isLoading } = useYoutubeTrendingVideosQuery(
    {},
    {
      onSuccess(data) {
        setFetchedVideos(data.youtubeTrendingVideos);
      }
    }
  );

  useEffect(() => {
    if (isLoading) return;

    if (showMore) {
      setTrendingVideos(fetchedVideos);
    } else {
      setTrendingVideos(fetchedVideos.slice(0, showLimit));
    }
  }, [fetchedVideos, isLoading, showMore]);

  const onClickAddToQueue = (videoInfo: VideoInfo): void => {
    addToPlayList(socket, videoInfo);
  };

  const onClickPlayVideo = (videoInfo: VideoInfo): void => {
    playNewVideo(socket, videoInfo);
  };

  if (isLoading) {
    return <CircleLoading />;
  }

  return (
    <VStack alignItems="start" p={0} spacing={10}>
      <SimpleGrid
        pt={2}
        columns={{
          base: 2,
          md: 3,
          xl: 4
        }}
        gap={6}
      >
        {trendingVideos.map((video, index) => (
          <QueryVideoCard
            key={`${index}${video.id}`}
            video={video}
            onClickAdd={() => onClickAddToQueue(video)}
            onClickPlay={() => onClickPlayVideo(video)}
          />
        ))}
      </SimpleGrid>

      <Button onClick={() => setShowMore(!showMore)}>
        {showMore ? 'Show Less' : 'Show More'}
      </Button>
    </VStack>
  );
};
