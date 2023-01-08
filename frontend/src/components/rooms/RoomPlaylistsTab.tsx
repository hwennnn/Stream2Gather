import { VideoCard } from '@app/components/rooms/VideoCard';
import { resetQueue } from '@app/lib/roomSocketService';
import { useRoomSocket } from '@app/pages/room/[slug]';
import useRoomStore from '@app/store/useRoomStore';
import { Button, VStack } from '@chakra-ui/react';
import { FC } from 'react';
import { SlRefresh } from 'react-icons/sl';
import shallow from 'zustand/shallow';

export const RoomPlaylistsTab: FC = () => {
  const { roomSocket } = useRoomSocket();
  const { playingIndex, playlist } = useRoomStore(
    (state) => ({
      playingIndex: state.playingIndex,
      playlist: state.playlist
    }),
    shallow
  );

  const handleResetQueue = (): void => {
    resetQueue(roomSocket);
  };

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
      <Button
        onClick={() => handleResetQueue()}
        leftIcon={<SlRefresh />}
        py="4"
      >
        Reset Queue
      </Button>
    </VStack>
  );
};
