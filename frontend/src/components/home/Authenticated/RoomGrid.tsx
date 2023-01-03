import { CircleLoading } from '@app/components/common/loading/CircleLoading';
import { RoomCard } from '@app/components/home/Authenticated/RoomCard';
import { OwnRoomItemFragment, useOwnRoomsQuery } from '@app/generated/graphql';
import { Grid } from '@chakra-ui/react';
import { FC, useState } from 'react';

export const RoomGrid: FC = () => {
  const [rooms, setRooms] = useState<OwnRoomItemFragment[]>([]);

  const { isLoading } = useOwnRoomsQuery(
    {},
    {
      onSuccess(data) {
        setRooms(data.ownRooms?.rooms ?? []);
      }
    }
  );

  if (isLoading) {
    return <CircleLoading />;
  }

  console.log(rooms);

  return (
    <Grid pt={10} px="4" w="100%" templateColumns="repeat(3, 1fr)" gap={6}>
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} />
      ))}
    </Grid>
  );
};
