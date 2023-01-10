import RoomNavbar from '@app/components/rooms/RoomNavbar';
import { Box, Flex } from '@chakra-ui/react';
import Head from 'next/head';
import { FC, PropsWithChildren } from 'react';

const RoomLayout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <Flex direction={'column'} width="full" mx="auto">
      <Head>
        <title>{'Room - Stream2Gather'}</title>
        <meta
          name="description"
          content={'A platform to watch videos in sync with your friends'}
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <RoomNavbar />

      <Box mx="auto" width="100vw" maxWidth="120em" flex="1" mt="72px">
        {children}
      </Box>
    </Flex>
  );
};

export default RoomLayout;
