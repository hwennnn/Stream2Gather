import { FullRoomItemFragment } from '@app/generated/graphql';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Divider,
  Heading,
  Image,
  Stack,
  Text
} from '@chakra-ui/react';
import Link from 'next/link';
import { FC } from 'react';

interface RoomCardProps {
  room: FullRoomItemFragment;
}

export const RoomCard: FC<RoomCardProps> = ({ room }) => {
  // const router = useRouter();

  // const navToRoom = (): void => {
  //   void router.push(`/room/${room.slug}`);
  // };

  return (
    // onClick={() => navToRoom()}
    <Card maxW="sm">
      <CardBody>
        <Image
          src={room.roomInfo.currentVideo.thumbnailUrl}
          alt={room.roomInfo.currentVideo.title}
          borderRadius="lg"
        />

        <Stack mt="6" spacing="2">
          <Heading size="xs">{room.slug}</Heading>
          <Text>{room.roomInfo.currentVideo.title}</Text>
          <Text color={'gray.400'} fontSize="sm">
            {room.roomInfo.currentVideo.author}
          </Text>
        </Stack>
      </CardBody>
      <Divider />

      <CardFooter w="full">
        <Button mx="auto" variant="solid" colorScheme="blue">
          <Link href={`room/${room.slug}`}>Join Room</Link>
        </Button>
      </CardFooter>
    </Card>
  );
};
