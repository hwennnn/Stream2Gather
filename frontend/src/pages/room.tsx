import { NextPage } from 'next';
import React, { useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Layout from '../components/Layout';
import { Player } from '../components/templates/rooms/Player';
import RoomSection from '../components/templates/rooms/RoomSection';
import { Loading } from '../components/ui/loading/Loading';
import { useAuth } from '../contexts/AuthContext';
import { useRoomQuery } from '../generated/graphql';
import {
  joinRoom,
  listenEvent,
  subscribeUserJoined,
  subscribeUserLeft
} from '../lib/roomSocketService';
import { setRoom } from '../store/useRoomStore';

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
      joinRoom(socket, roomId, user?.id);
      subscribeUserJoined(socket);
      subscribeUserLeft(socket);

      listenEvent(socket);

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
            <div className="flex flex-col tablet:flex-row w-full">
              <Player />
              <RoomSection />
            </div>
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
