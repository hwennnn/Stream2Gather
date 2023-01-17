import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { QueryVideoCard } from '@app/components/rooms/QueryVideoCard';
import { useSearchYoutubeVideosQuery, VideoInfo } from '@app/generated/graphql';
import { addToPlayList, playNewVideo } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import useRoomStore from '@app/store/useRoomStore';
import { Box, Button, Flex, SimpleGrid, Text, VStack } from '@chakra-ui/react';
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
        <Text>No results available.</Text>
      </Box>
    );
  }

  return (
    <VStack alignItems="start" p={0} spacing={5}>
      {searchQuery.length > 0 && (
        <Flex>
          <Text fontSize="md">Search Result for</Text>
          <Text ml="1" as="b">
            {searchQuery}
          </Text>
        </Flex>
      )}

      {isLoading ? (
        <CircleLoading mt="10" alignSelf="center" />
      ) : (
        <>
          <SimpleGrid
            columns={{
              base: 2,
              md: 3,
              xl: 4,
              '2xl': 5
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
          </SimpleGrid>

          <Button onClick={() => setShowMore(!showMore)}>
            {showMore ? 'Show Less' : 'Show More'}
          </Button>
        </>
      )}
    </VStack>
  );
};
