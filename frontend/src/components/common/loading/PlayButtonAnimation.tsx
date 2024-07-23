'use client';

import playButtonAnimation from '@app/assets/loading/play-loading.json';
import { Box } from '@chakra-ui/react';
import dynamic from 'next/dynamic';
import { FC, memo } from 'react';

interface Props {
  width?: number;
}

const RawLoadingAnimation: FC<Props> = ({ width = 15 }) => {
  return (
    <Box height="auto" width={`${width}em`}>
      <PlayerWithNoSSR
        src={playButtonAnimation}
        speed={2}
        loop={true}
        autoplay={true}
      />
    </Box>
  );
};

const PlayerWithNoSSR = dynamic(
  async () =>
    await import('@lottiefiles/react-lottie-player').then(
      (module) => module.Player
    ),
  { ssr: false }
);

export const PlayButtonAnimation = memo(RawLoadingAnimation);
