import { Loading } from '@app/components/common/loading/Loading';
import RoomAlreadyJoined from '@app/components/rooms/errors/RoomAlreadyJoined';
import RoomDoesNotExist from '@app/components/rooms/errors/RoomDoesNotExist';
import RoomInactive from '@app/components/rooms/errors/RoomInactive';
import RoomNoPermission from '@app/components/rooms/errors/RoomNoPermission';
import RoomLayout from '@app/components/rooms/RoomLayout';
import RoomPrimarySection from '@app/components/rooms/RoomPrimarySection';
import RoomSecondarySection from '@app/components/rooms/RoomSecondarySection';
import { useAuth } from '@app/contexts/AuthContext';
import { FullRoomItemFragment, useRoomQuery } from '@app/generated/graphql';
import { initSocketForRoom } from '@app/lib/roomSocketService';
import useRoomStore, {
  resetRoom,
  RoomJoiningStatus,
  setRoom
} from '@app/store/useRoomStore';
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

  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const joiningStatus = useRoomStore((state) => state.status);
  const { isLoading: isRoomQueryLoading } = useRoomQuery(
    { slug: slug as string },
    {
      onSuccess: (data) => {
        resetRoom();
        if (data.room !== null && data.room !== undefined) {
          setRoom(data.room as FullRoomItemFragment);
        }
      }
    }
  );

  useEffect(() => {
    let newSocket: Socket | null = null;

    newSocket = io(`${process.env.SERVER_URL}`, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    });

    if (
      typeof slug === 'string' &&
      user?.id !== undefined &&
      user?.username !== undefined
    ) {
      initSocketForRoom(newSocket, slug, user?.id, user?.username);
    }

    setSocket(newSocket);

    return (): void => {
      newSocket?.disconnect();
      setSocket(null);
    };
  }, [slug, user?.id, user?.username]);

  if (
    socket === null ||
    joiningStatus === RoomJoiningStatus.LOADING ||
    isRoomQueryLoading
  ) {
    return <Loading />;
  }

  if (joiningStatus === RoomJoiningStatus.NO_PERMISSION) {
    return <RoomNoPermission />;
  }

  if (joiningStatus === RoomJoiningStatus.INACTIVE) {
    return <RoomInactive />;
  }

  if (joiningStatus === RoomJoiningStatus.DOES_NOT_EXIST) {
    return <RoomDoesNotExist />;
  }

  if (joiningStatus === RoomJoiningStatus.ALREADY_IN_ROOM) {
    return <RoomAlreadyJoined />;
  }

  return (
    <RoomLayout>
      <RoomSocketContext.Provider value={{ roomSocket: socket }}>
        <Flex
          flexDirection={{ base: 'column', lg: 'row' }}
          mx="auto"
          px="4"
          pt="24px"
          width="full"
        >
          <RoomPrimarySection />
          <RoomSecondarySection />
        </Flex>
      </RoomSocketContext.Provider>
    </RoomLayout>
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
