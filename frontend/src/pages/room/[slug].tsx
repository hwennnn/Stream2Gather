import Layout from '@app/components/common/layouts/Layout';
import { Loading } from '@app/components/common/loading/Loading';
import { Player } from '@app/components/rooms/Player';
import RoomSection from '@app/components/rooms/RoomSection';
import { useAuth } from '@app/contexts/AuthContext';
import { FullRoomItemFragment, useRoomQuery } from '@app/generated/graphql';
import {
  joinRoom,
  listenEvent,
  subscribeUserJoined,
  subscribeUserLeft
} from '@app/lib/roomSocketService';
import { setRoom } from '@app/store/useRoomStore';
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
  const { slug } = useRouter().query;
  const roomSlug = slug as string;

  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const { isLoading: isRoomLoading } = useRoomQuery(
    { slug: roomSlug },
    {
      onSuccess: (data) => {
        setRoom(data.room as FullRoomItemFragment);
      }
    }
  );

  useEffect(() => {
    if (socket !== null) {
      joinRoom(socket, roomSlug, user);
      subscribeUserJoined(socket);
      subscribeUserLeft(socket);

      listenEvent(socket);

      return (): void => {
        socket.disconnect();
      };
    }

    return (): void => {};
  }, [roomSlug, socket, user]);

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

  return (
    <Layout title="Room">
      {isRoomLoading || socket === null ? (
        <Loading />
      ) : (
        <>
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
        </>
      )}
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
