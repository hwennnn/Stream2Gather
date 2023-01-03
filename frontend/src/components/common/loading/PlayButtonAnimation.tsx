import playButtonAnimation from '@app/assets/loading/play-loading.json';
import { Box } from '@chakra-ui/react';
import { Player } from '@lottiefiles/react-lottie-player';
import { FC, memo } from 'react';

interface Props {
  width?: number;
}

const RawLoadingAnimation: FC<Props> = ({ width = 15 }) => {
  return (
    <Box height="auto" width={`${width}em`}>
      <Player src={playButtonAnimation} speed={2} loop={true} autoplay={true} />
    </Box>
  );
};

export const PlayButtonAnimation = memo(RawLoadingAnimation);
