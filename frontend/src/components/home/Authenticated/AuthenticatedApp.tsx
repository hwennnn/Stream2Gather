import { PrimaryButton } from '@app/components/common/buttons/PrimaryButton';
import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { RoomGrid } from '@app/components/home/Authenticated/RoomGrid';
import { useCreateRoomMutation, useRoomsQuery } from '@app/generated/graphql';
import { VStack } from '@chakra-ui/react';
import { useRouter } from 'next/router';
import { FC } from 'react';

const AuthenticatedApp: FC = () => {
  const router = useRouter();
  const { isLoading } = useRoomsQuery();
  const { mutateAsync } = useCreateRoomMutation();

  const createRoom = async (): Promise<void> => {
    const result = await mutateAsync({});
    const roomId = result.createRoom?.room?.id;
    if (roomId !== undefined) {
      await router.push(`/room?id=${roomId}`);
    }
  };

  if (isLoading) {
    return <CircleLoading />;
  }

  return (
    <VStack justify="center" mt="10">
      <PrimaryButton
        title="Create a Room"
        onClick={async () => await createRoom()}
      />

      <RoomGrid />
    </VStack>
  );
};

export default AuthenticatedApp;
