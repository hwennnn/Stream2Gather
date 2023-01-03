import Layout from '@app/components/common/layouts/Layout';
import { Loading } from '@app/components/common/loading/Loading';
import { Player } from '@app/components/rooms/Player';
import RoomSection from '@app/components/rooms/RoomSection';
import { useAuth } from '@app/contexts/AuthContext';
import { useRoomQuery } from '@app/generated/graphql';
import {
  joinRoom,
  listenEvent,
  subscribeUserJoined,
  subscribeUserLeft
} from '@app/lib/roomSocketService';
import { setRoom } from '@app/store/useRoomStore';
import { Flex } from '@chakra-ui/react';
import { NextPage } from 'next';
import React, { useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface Props {
  roomId: string;
}

export interface RoomSocketContextInterface {
  roomSocket: Socket;
}

const RoomSocketContext = React.createContext<
  RoomSocketContextInterface | undefined
>(undefined);

const RoomPage: NextPage<Props> = ({ roomId }: Props) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const { isLoading: isRoomLoading } = useRoomQuery(
    { id: roomId },
    {
      onSuccess: (data) => {
        setRoom(data);
      }
    }
  );

  useEffect(() => {
    if (socket !== null) {
      joinRoom(socket, roomId, user);
      subscribeUserJoined(socket);
      subscribeUserLeft(socket);

      listenEvent(socket);

      return (): void => {
        socket.disconnect();
      };
    }

    return (): void => {};
  }, [roomId, socket, user]);

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

RoomPage.getInitialProps = async ({ res, query }) => {
  const { id: roomId } = query;

  if (typeof roomId !== 'string') {
    if (res !== undefined) {
      res.writeHead(307, { Location: '/' });
      res.end();
    }

    // to satisfy the type checker (NOT MEANINGFUL)
    return { roomId: '' };
  }

  return { roomId };
};

export const useRoomSocket = (): RoomSocketContextInterface => {
  const context = useContext(RoomSocketContext);
  if (context === undefined) {
    throw new Error('useRoomSocket must be used within a RoomSocketProvider');
  }
  return context;
};

export default RoomPage;
