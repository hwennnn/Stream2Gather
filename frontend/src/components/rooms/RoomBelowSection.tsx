import { TrendingVideosSection } from '@app/components/rooms/TrendingVideosSection';
import { Box } from '@chakra-ui/react';
import { FC } from 'react';

export const RoomBelowSection: FC = () => {
  return (
    <Box mt="8">
      <TrendingVideosSection />
    </Box>
  );
};
