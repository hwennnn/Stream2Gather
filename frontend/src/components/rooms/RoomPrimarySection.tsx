import { Footer } from '@app/components/common/layouts/Footer';
import { Player } from '@app/components/rooms/Player';
import { RoomBelowSection } from '@app/components/rooms/RoomBelowSection';
import useUserSettingsStore from '@app/store/useUserSettingsStore';
import { Box } from '@chakra-ui/react';
import { FC } from 'react';
import shallow from 'zustand/shallow';

const RoomPrimarySection: FC = () => {
  const { isTheatreMode } = useUserSettingsStore(
    (state) => ({
      isTheatreMode: state.isTheatreMode
    }),
    shallow
  );

  return (
    <Box
      w="100%"
      mr={{
        base: '0',
        lg: isTheatreMode ? '0' : 'calc(24rem + 24px)',
        xl: isTheatreMode ? '0' : 'calc(28rem + 24px)'
      }}
    >
      <Player />
      <RoomBelowSection />
      <Footer px="0" />
    </Box>
  );
};

export default RoomPrimarySection;
