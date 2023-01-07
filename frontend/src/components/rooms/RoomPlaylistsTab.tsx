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
    <VStack>
      {playlist.map((video, index) => (
        <VideoCard
          key={video.id}
          video={video}
          isPlaying={index === playingIndex}
        />
      ))}
    </VStack>
  );
};
