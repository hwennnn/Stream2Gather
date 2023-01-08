import { QueryVideoCard } from '@app/components/rooms/QueryVideoCard';
import {
  useYoutubeTrendingVideosQuery,
  VideoInfo
} from '@app/generated/graphql';
import { Box, Button, Grid, Text } from '@chakra-ui/react';
import { FC, useEffect, useState } from 'react';

const showLimit = 8;

export const RoomBelowSection: FC = () => {
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

  if (isLoading) {
    return <Box />;
  }

  return (
    <Box mt="8">
      <Text fontSize="lg">Trending Videos</Text>

      <Grid
        pt={2}
        templateColumns={{
          base: 'repeat(2, 1fr)',
          md: 'repeat(3, 1fr)',
          xl: 'repeat(4, 1fr)'
        }}
        gap={6}
      >
        {trendingVideos.map((video) => (
          <QueryVideoCard key={video.id} video={video} />
        ))}
      </Grid>

      <Button mt="10" mx="auto" onClick={() => setShowMore(!showMore)}>
        {showMore ? 'Show Less' : 'Show More'}
      </Button>
    </Box>
  );
};
