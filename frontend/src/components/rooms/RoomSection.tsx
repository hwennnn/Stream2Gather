import useRoomStore from '@app/store/useRoomStore';
import { Box } from '@chakra-ui/react';
import { FC } from 'react';

const RoomSection: FC = () => {
  const activeMembers = useRoomStore((state) => state.activeMembers);

  return (
    <>
      <Box width={{ base: '100%', lg: '30%' }} bg={'gray.700'}>
        {activeMembers.map((member) => (
          <div key={member.uid}>{member.username}</div>
        ))}
      </Box>
    </>
  );
};

export default RoomSection;
