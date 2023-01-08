import { FullRoomItemFragment } from '@app/generated/graphql';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Divider,
  Image,
  Stack,
  Text,
  useColorModeValue
} from '@chakra-ui/react';
import NextLink from 'next/link';
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
          <Text fontWeight="bold" fontSize="lg">
            {room.slug}
          </Text>
          <Text noOfLines={2}>{room.roomInfo.currentVideo.title}</Text>
          <Text color={useColorModeValue('gray.700', 'gray.400')} fontSize="sm">
            {room.roomInfo.currentVideo.author}
          </Text>
        </Stack>
      </CardBody>
      <Divider />

      <CardFooter w="full">
        <Button
          mx="auto"
          as={NextLink}
          href={`room/${room.slug}`}
          variant="solid"
          colorScheme="blue"
        >
          Join Room
        </Button>
      </CardFooter>
    </Card>
  );
};
