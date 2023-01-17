import useRoomStore from '@app/store/useRoomStore';
import useUserSettingsStore from '@app/store/useUserSettingsStore';
import { Avatar, HStack, Text, VStack } from '@chakra-ui/react';
import { FC } from 'react';

export const RoomMembersTab: FC = () => {
  const isTheatreMode = useUserSettingsStore((state) => state.isTheatreMode);
  const activeMembers = useRoomStore((state) => state.activeMembers);

  return (
    <>
      <VStack
        h={{
          base: '614px',
          lg: isTheatreMode ? '614px' : 'calc(100vh - 188px)'
        }}
        overflowY="scroll"
        mx={1}
        alignItems="flex-start"
        spacing={4}
      >
        {activeMembers.map((member, index) => (
          <HStack key={`${index}${member.uid}`}>
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
