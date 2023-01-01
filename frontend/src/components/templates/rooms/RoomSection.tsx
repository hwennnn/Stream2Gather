import { FC } from 'react';
import useRoomStore from '../../../store/useRoomStore';

const RoomSection: FC = () => {
  const activeMembers = useRoomStore((state) => state.activeMembers);

  return (
    <>
      <div className="w-full tablet:w-1/4 bg-gray-600">
        {activeMembers.map((member) => (
          <div key={member.uid}>{member.uid}</div>
        ))}
      </div>
    </>
  );
};

export default RoomSection;
