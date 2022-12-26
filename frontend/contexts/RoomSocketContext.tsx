import React, { PropsWithChildren, useContext, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { CONNECT } from '../constants/socket';

export default interface RoomSocketContextInterface {
  roomSocket: Socket;
}

const RoomSocketContext = React.createContext<
  RoomSocketContextInterface | undefined
>(undefined);

interface RoomSocketProviderType {
  children: React.ReactNode;
}

const RoomSocketProvider: React.FC<
  PropsWithChildren<RoomSocketProviderType>
> = ({ children }) => {
  const socket = io(`${process.env.SERVER_URL}`, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
  });

  console.log(socket.connected, socket.id, process.env.SERVER_URL);

  useEffect(() => {
    socket.on(CONNECT, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('Room socket connected!');
      }
    });

    const listener = (eventName: string, ...args: any): void => {
      console.log(eventName, args);
    };

    if (process.env.NODE_ENV !== 'production') {
      socket.onAny(listener);
    }

    return (): void => {
      socket.disconnect();
    };
  }, [socket]);

  return (
    <RoomSocketContext.Provider value={{ roomSocket: socket }}>
      {children}
    </RoomSocketContext.Provider>
  );
};

const useRoomSocket = (): RoomSocketContextInterface => {
  const context = useContext(RoomSocketContext);
  if (context === undefined) {
    throw new Error('useRoomSocket must be used within a RoomSocketProvider');
  }
  return context;
};

export { RoomSocketProvider, useRoomSocket };
