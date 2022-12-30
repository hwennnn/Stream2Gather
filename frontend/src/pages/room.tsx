import { NextPage } from 'next';
import RoomComponent from '../components/rooms/RoomComponent';
import { RoomSocketProvider } from '../contexts/RoomSocketContext';

interface Props {
  roomId: string;
}

const RoomPage: NextPage<Props> = ({ roomId }: Props) => {
  return (
    <RoomSocketProvider>
      <RoomComponent roomId={roomId} />
    </RoomSocketProvider>
  );
};

RoomPage.getInitialProps = async ({ res, query }) => {
  const { id: roomId } = query;

  if (typeof roomId !== 'string') {
    if (res !== undefined) {
      res.writeHead(307, { Location: '/' });
      res.end();
    }

    // to satisfy the type checker
    return { roomId: '' };
  }

  return { roomId };
};

export default RoomPage;
