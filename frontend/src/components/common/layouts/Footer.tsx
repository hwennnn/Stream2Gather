import { Box, Text } from '@chakra-ui/react';
import { FC, memo } from 'react';

const RawFooter: FC = () => {
  return (
    <Box mt="20" px="4" py="4">
      <Text>© 2023 Stream2Gather. All rights reserved</Text>
    </Box>
  );
};

export const Footer = memo(RawFooter);
