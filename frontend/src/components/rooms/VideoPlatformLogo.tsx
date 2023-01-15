import { Box, Icon } from '@chakra-ui/react';
import { FC } from 'react';
import { BsYoutube } from 'react-icons/bs';

const VideoPlatformLogo: FC<{ platform: string }> = ({ platform }) => {
  if (platform === 'YOUTUBE') {
    return <Icon mr={2} as={BsYoutube} color="red" />;
  }

  return <Box></Box>;
};

export default VideoPlatformLogo;
