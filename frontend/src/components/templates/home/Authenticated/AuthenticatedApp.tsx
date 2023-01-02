import { Flex } from '@chakra-ui/react';
import { useRouter } from 'next/router';
import { FC } from 'react';
import {
  useCreateRoomMutation,
  useRoomsQuery
} from '../../../../generated/graphql';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { CircleLoading } from '../../../ui/loading/CircleLoading';

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
    <Flex justify="center">
      <PrimaryButton
        title="Create a Room"
        onClick={async () => await createRoom()}
      />
    </Flex>
  );
};

export default AuthenticatedApp;
