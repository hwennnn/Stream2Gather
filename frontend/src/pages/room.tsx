import { NextPage } from 'next';
import React, { useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Layout from '../components/common/Layout';
import { Loading } from '../components/common/loading/Loading';
import { Player } from '../components/rooms/Player';
import { useAuth } from '../contexts/AuthContext';
import { useRoomQuery } from '../generated/graphql';
import { joinRoom, listenEvent } from '../lib/roomSocketService';
import { setRoomInfo } from '../store/useRoomStore';

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
    { id: '1' },
    {
      onSuccess: (data) => {
        setRoomInfo(data);
      }
    }
  );

  useEffect(() => {
    if (socket !== null) {
      listenEvent(socket);

      joinRoom(socket, roomId, user?.id);

      return (): void => {
        socket.disconnect();
      };
    }

    return (): void => {};
  }, [roomId, socket, user?.id]);

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
            <Player />
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
