import { OwnRoomItemFragment } from '@app/generated/graphql';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Divider,
  Heading,
  Stack,
  Text
} from '@chakra-ui/react';
import Link from 'next/link';
import { FC } from 'react';

interface RoomCardProps {
  room: OwnRoomItemFragment;
}

export const RoomCard: FC<RoomCardProps> = ({ room }) => {
  return (
    <Card maxW="sm">
      <CardBody>
        {/* <Image
          src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80"
          alt="Green double couch with wooden legs"
          borderRadius="lg"
        /> */}

        <Stack mt="6" spacing="3">
          <Heading size="md">{`Room ${room.id}`}</Heading>
          <Text>{`Playing ${room.roomInfo.currentUrl}`}</Text>
        </Stack>
      </CardBody>
      <Divider />

      <CardFooter w="full">
        <Button mx="auto" variant="solid" colorScheme="blue">
          <Link href={`room/${room.id as string}`}>Join Room</Link>
        </Button>
      </CardFooter>
    </Card>
  );
};
