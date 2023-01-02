import { Box } from '@chakra-ui/react';
import { FC } from 'react';
import useRoomStore from '../../../store/useRoomStore';

const RoomSection: FC = () => {
  const activeMembers = useRoomStore((state) => state.activeMembers);

  return (
    <>
      <Box width={{ base: '100%', md: '25%' }} bg={'gray.700'}>
        {activeMembers.map((member) => (
          <div key={member.uid}>{member.uid}</div>
        ))}
      </Box>
    </>
  );
};

export default RoomSection;
