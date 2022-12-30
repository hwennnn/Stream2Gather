import React, {
  PropsWithChildren,
  useContext,
  useEffect,
  useState
} from 'react';
import { io, Socket } from 'socket.io-client';
import { Loading } from '../components/common/loading/Loading';
import { CONNECT } from '../constants/socket';

export default interface RoomSocketContextInterface {
  roomSocket: Socket;
}

const RoomSocketContext = React.createContext<
  RoomSocketContextInterface | undefined
>(undefined);

const RoomSocketProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);

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

  useEffect(() => {
    if (socket !== null) {
      socket.on(CONNECT, () => {
        if (process.env.NODE_ENV !== 'production') {
          console.log('Room socket connected!', socket.id);
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
    }

    return (): void => {};
  }, [socket]);

  return socket === null ? (
    <Loading />
  ) : (
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
