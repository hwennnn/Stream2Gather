import { Loading } from '@app/components/common/loading/Loading';
import RoomAlreadyFull from '@app/components/rooms/errors/RoomAlreadyFull';
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
import useUserSettingsStore from '@app/store/useUserSettingsStore';
import { Flex } from '@chakra-ui/react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import React, { useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import shallow from 'zustand/shallow';

export interface RoomContextInterface {
  socket: Socket;
}

const RoomContext = React.createContext<RoomContextInterface | undefined>(
  undefined
);

const RoomPage: NextPage = () => {
  const { slug, invitationCode } = useRouter().query;

  const { isTheatreMode } = useUserSettingsStore(
    (state) => ({
      isTheatreMode: state.isTheatreMode
    }),
    shallow
  );

  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const joiningStatus = useRoomStore((state) => state.status);
  const { isLoading: isRoomQueryLoading } = useRoomQuery(
    { slug: slug as string },
    {
      enabled: joiningStatus === RoomJoiningStatus.SUCCESS,
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
      initSocketForRoom(
        newSocket,
        slug,
        user?.id,
        user?.username,
        invitationCode as string | undefined
      );
    }

    setSocket(newSocket);

    return (): void => {
      newSocket?.disconnect();
      setSocket(null);
    };
  }, [invitationCode, slug, user?.id, user?.username]);

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

  if (joiningStatus === RoomJoiningStatus.ALREADY_FULL) {
    return <RoomAlreadyFull />;
  }

  if (
    socket === null ||
    joiningStatus === RoomJoiningStatus.LOADING ||
    isRoomQueryLoading
  ) {
    return <Loading />;
  }

  return (
    <RoomLayout>
      <RoomContext.Provider value={{ socket }}>
        <Flex
          flexDirection={{
            base: 'column',
            lg: isTheatreMode ? 'column' : 'row'
          }}
          mx="auto"
          px="4"
          pt="24px"
        >
          <RoomPrimarySection />
          <RoomSecondarySection />
        </Flex>
      </RoomContext.Provider>
    </RoomLayout>
  );
};

export const useRoomContext = (): RoomContextInterface => {
  const context = useContext(RoomContext);
  if (context === undefined) {
    throw new Error('useRoomContext must be used within a RoomSocketProvider');
  }
  return context;
};

export default RoomPage;
