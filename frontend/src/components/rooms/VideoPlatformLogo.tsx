import { Box, Icon } from '@chakra-ui/react';
import { FC } from 'react';
import { BsYoutube } from 'react-icons/bs';

const VideoPlatformLogo: FC<{ platform: string }> = ({ platform }) => {
  if (platform === 'YOUTUBE') {
    return (
      <Icon
        height={4}
        width={4}
        verticalAlign="top"
        mr={2}
        as={BsYoutube}
        color="red"
      />
    );
  }

  return <Box></Box>;
};

export default VideoPlatformLogo;
