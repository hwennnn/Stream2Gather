import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { QueryVideoCard } from '@app/components/rooms/QueryVideoCard';
import { useSearchYoutubeVideosQuery, VideoInfo } from '@app/generated/graphql';
import { addToPlayList, playNewVideo } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import useRoomStore from '@app/store/useRoomStore';
import { Box, Button, Grid, Text } from '@chakra-ui/react';
import { FC, useEffect, useState } from 'react';
import shallow from 'zustand/shallow';

const showLimit = 9;

export const SearchResultSection: FC = () => {
  const { searchQuery } = useRoomStore(
    (state) => ({
      searchQuery: state.searchQuery
    }),
    shallow
  );
  const { socket } = useRoomContext();
  const [fetchedVideos, setFetchedVideos] = useState<VideoInfo[]>([]);
  const [showMore, setShowMore] = useState(false);

  const [searchResults, setSearchResults] = useState<VideoInfo[]>([]);

  const { isLoading } = useSearchYoutubeVideosQuery(
    { keyword: searchQuery },
    {
      enabled: searchQuery.length > 0,
      onSuccess(data) {
        setFetchedVideos(data.youtubeVideos);
      }
    }
  );

  useEffect(() => {
    if (isLoading) return;

    if (showMore) {
      setSearchResults(fetchedVideos);
    } else {
      setSearchResults(fetchedVideos.slice(0, showLimit));
    }
  }, [fetchedVideos, isLoading, showMore]);

  const onClickAddToQueue = (videoInfo: VideoInfo): void => {
    addToPlayList(socket, videoInfo);
  };

  const onClickPlayVideo = (videoInfo: VideoInfo): void => {
    playNewVideo(socket, videoInfo);
  };

  if (searchQuery.length === 0) {
    return (
      <Box>
        <Text>No result available.</Text>
      </Box>
    );
  }

  return (
    <Box>
      {searchQuery.length > 0 && (
        <Text fontSize="lg">Search Result for {searchQuery}</Text>
      )}

      {isLoading ? (
        <CircleLoading marginTop="10" />
      ) : (
        <>
          <Grid
            pt={6}
            templateColumns={{
              base: 'repeat(2, 1fr)',
              md: 'repeat(3, 1fr)',
              xl: 'repeat(4, 1fr)'
            }}
            gap={6}
          >
            {searchResults.map((video, index) => (
              <QueryVideoCard
                key={`${index}${video.id}`}
                video={video}
                onClickAdd={() => onClickAddToQueue(video)}
                onClickPlay={() => onClickPlayVideo(video)}
              />
            ))}
          </Grid>

          <Button mt="10" onClick={() => setShowMore(!showMore)}>
            {showMore ? 'Show Less' : 'Show More'}
          </Button>
        </>
      )}
    </Box>
  );
};
