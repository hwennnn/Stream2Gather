import useRoomStore from '@app/store/useRoomStore';
import useUserSettingsStore from '@app/store/useUserSettingsStore';
import { Avatar, HStack, Icon, Text, VStack } from '@chakra-ui/react';
import { FC } from 'react';
import { FaCrown } from 'react-icons/fa';

export const RoomMembersTab: FC = () => {
  const creatorId = useRoomStore.getState().creatorId;
  const isTheatreMode = useUserSettingsStore((state) => state.isTheatreMode);
  const activeMembers = useRoomStore((state) => state.activeMembers).sort(
    (a, b) => a.username.localeCompare(b.username)
  );

  return (
    <>
      <VStack
        h={{
          base: '614px',
          lg: isTheatreMode ? '614px' : 'calc(100vh - 188px)'
        }}
        overflowY="scroll"
        mx={2}
        alignItems="flex-start"
        spacing={4}
      >
        {activeMembers.map((member, index) => (
          <HStack w="full" key={`${index}${member.uid}`}>
            <Avatar
              name={member?.username}
              size={'sm'}
              src={member?.displayPhoto ?? undefined}
            />

            <Text>{member.username}</Text>
            {creatorId === member?.uid && <Icon color="orange" as={FaCrown} />}
          </HStack>
        ))}
      </VStack>
    </>
  );
};
