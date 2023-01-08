import { Footer } from '@app/components/common/layouts/Footer';
import { Player } from '@app/components/rooms/Player';
import { RoomBelowSection } from '@app/components/rooms/RoomBelowSection';
import { Box } from '@chakra-ui/react';
import { FC } from 'react';

const RoomPrimarySection: FC = () => {
  return (
    <>
      <Box
        width="full"
        mr={{
          base: '0',
          lg: 'calc(24rem + 24px)',
          xl: 'calc(28rem + 24px)'
        }}
      >
        <Player />
        <RoomBelowSection />
        <Footer px="0" />
      </Box>
    </>
  );
};

export default RoomPrimarySection;
