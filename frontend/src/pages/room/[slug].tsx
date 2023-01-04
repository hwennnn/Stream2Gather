import Layout from '@app/components/common/layouts/Layout';
import { Loading } from '@app/components/common/loading/Loading';
import { Player } from '@app/components/rooms/Player';
import RoomSection from '@app/components/rooms/RoomSection';
import { useAuth } from '@app/contexts/AuthContext';
import { initSocketForRoom, joinRoom } from '@app/lib/roomSocketService';
import useRoomStore, { RoomJoiningStatus } from '@app/store/useRoomStore';
import { Flex } from '@chakra-ui/react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import React, { useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export interface RoomSocketContextInterface {
  roomSocket: Socket;
}

const RoomSocketContext = React.createContext<
  RoomSocketContextInterface | undefined
>(undefined);

const RoomPage: NextPage = () => {
  const { slug: querySlug } = useRouter().query;
  const slug = querySlug as string;

  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const joiningStatus = useRoomStore((state) => state.status);

  useEffect(() => {
    if (socket !== null) {
      joinRoom(socket, slug, user);
      initSocketForRoom(socket);

      return (): void => {
        socket.disconnect();
      };
    }

    return (): void => {};
  }, [slug, socket, user]);

  useEffect(() => {
    setSocket(
      io(`${process.env.SERVER_URL}`, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
      })
    );
  }, []);

  if (socket === null || joiningStatus !== RoomJoiningStatus.SUCCESS) {
    return <Loading />;
  }

  return (
    <Layout title="Room">
      <RoomSocketContext.Provider value={{ roomSocket: socket }}>
        <Flex
          flexDirection={{ base: 'column', lg: 'row' }}
          maxW="120em"
          mx="auto"
        >
          <Player />
          <RoomSection />
        </Flex>
      </RoomSocketContext.Provider>
    </Layout>
  );
};

export const useRoomSocket = (): RoomSocketContextInterface => {
  const context = useContext(RoomSocketContext);
  if (context === undefined) {
    throw new Error('useRoomSocket must be used within a RoomSocketProvider');
  }
  return context;
};

export default RoomPage;
