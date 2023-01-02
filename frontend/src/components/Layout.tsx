import { Box } from '@chakra-ui/react';
import Head from 'next/head';
import { FC, PropsWithChildren } from 'react';
import Navbar from './Navbar';

interface LayoutProps {
  title?: string;
  description?: string;
}

const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  description,
  children
}) => {
  return (
    <Box width="full" mx="auto">
      <Head>
        <title>
          {title !== undefined
            ? `${title} - Stream2Gather`
            : 'Stream2Gather | Stay Connected made easier'}
        </title>
        <meta
          name="description"
          content={
            description ??
            'A platform to watch videos in sync with your friends'
          }
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Navbar />

      {children}
    </Box>
  );
};

export default Layout;
