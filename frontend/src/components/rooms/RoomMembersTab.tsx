import useRoomStore from '@app/store/useRoomStore';
import { Text } from '@chakra-ui/react';
import { FC } from 'react';

export const RoomMembersTab: FC = () => {
  const activeMembers = useRoomStore((state) => state.activeMembers);

  return (
    <>
      {activeMembers.map((member) => (
        <Text key={member.uid}>{member.username}</Text>
      ))}
    </>
  );
};
