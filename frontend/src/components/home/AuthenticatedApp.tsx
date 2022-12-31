import { useRouter } from 'next/router';
import { FC } from 'react';
import { useCreateRoomMutation } from '../../generated/graphql';
import { PrimaryButton } from '../common/buttons/PrimaryButton';

const AuthenticatedApp: FC = () => {
  const router = useRouter();
  const { mutateAsync } = useCreateRoomMutation();

  const createRoom = async (): Promise<void> => {
    const result = await mutateAsync({});
    const roomId = result.createRoom?.room?.id;
    if (roomId !== undefined) {
      await router.push(`/room?id=${roomId}`);
    }
  };

  return (
    <div className="flex justify-center">
      <PrimaryButton
        title="Create a Room"
        onClick={async () => await createRoom()}
      />
    </div>
  );
};

export default AuthenticatedApp;
