import useRoomStore from '@app/store/useRoomStore';
import { Avatar, HStack, Text, VStack } from '@chakra-ui/react';
import { FC } from 'react';

export const RoomMembersTab: FC = () => {
  const activeMembers = useRoomStore((state) => state.activeMembers);

  return (
    <>
      <VStack mx={1} alignItems="flex-start" spacing={4}>
        {activeMembers.map((member) => (
          <HStack key={member.uid}>
            <Avatar
              name={member?.username}
              size={'sm'}
              src={member?.displayPhoto ?? undefined}
            />
            <Text>{member.username}</Text>
          </HStack>
        ))}
      </VStack>
    </>
  );
};
