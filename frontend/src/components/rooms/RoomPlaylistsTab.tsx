import { PlaylistCard } from '@app/components/rooms/PlaylistCard';
import { resetQueue } from '@app/lib/roomSocketService';
import { useRoomContext } from '@app/pages/room/[slug]';
import useRoomStore from '@app/store/useRoomStore';
import useUserSettingsStore from '@app/store/useUserSettingsStore';
import { Box, Button, VStack } from '@chakra-ui/react';
import { FC } from 'react';
import { VscClearAll } from 'react-icons/vsc';
import shallow from 'zustand/shallow';

export const RoomPlaylistsTab: FC = () => {
  const isTheatreMode = useUserSettingsStore((state) => state.isTheatreMode);

  const { socket } = useRoomContext();
  const { playingIndex, playlist } = useRoomStore(
    (state) => ({
      playingIndex: state.playingIndex,
      playlist: state.playlist
    }),
    shallow
  );

  const handleResetQueue = (): void => {
    resetQueue(socket);
  };

  return (
    <VStack
      h={{ base: '614px', lg: isTheatreMode ? '614px' : 'calc(100vh - 188px)' }}
      overflowY="scroll"
      spacing={0}
    >
      {playlist.map((video, index) => (
        <PlaylistCard
          key={`${index}${video.id}`}
          index={index}
          video={video}
          isPlaying={index === playingIndex}
        />
      ))}

      <Box pt="4">
        <Button
          onClick={() => handleResetQueue()}
          leftIcon={<VscClearAll />}
          py="4"
        >
          Clear Queue
        </Button>
      </Box>
    </VStack>
  );
};
