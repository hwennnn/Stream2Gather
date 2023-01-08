import { VideoCard } from '@app/components/rooms/VideoCard';
import useRoomStore from '@app/store/useRoomStore';
import { VStack } from '@chakra-ui/react';
import { FC } from 'react';
import shallow from 'zustand/shallow';

export const RoomPlaylistsTab: FC = () => {
  const { playingIndex, playlist } = useRoomStore(
    (state) => ({
      playingIndex: state.playingIndex,
      playlist: state.playlist
    }),
    shallow
  );

  return (
    <VStack
      spacing={3}
      h={{ base: '614px', lg: 'calc(100vh - 188px)' }}
      overflowY="scroll"
    >
      {playlist.map((video, index) => (
        <VideoCard
          key={`${index}${video.id}`}
          video={video}
          isPlaying={index === playingIndex}
        />
      ))}
    </VStack>
  );
};
