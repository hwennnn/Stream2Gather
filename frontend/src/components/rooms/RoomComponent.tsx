import { FC, useEffect } from 'react';
import { REQ_JOIN_ROOM } from '../../constants/socket';
import { useAuth } from '../../contexts/AuthContext';
import { useRoomSocket } from '../../contexts/RoomSocketContext';
import { useRoomQuery } from '../../generated/graphql';
import { setRoomInfo } from '../../store/useRoomStore';
import Layout from '../common/Layout';
import { Loading } from '../common/loading/Loading';
import { Player } from './Player';

interface Props {
  roomId: string;
}

const RoomComponent: FC<Props> = ({ roomId }) => {
  const { user } = useAuth();
  const { roomSocket: socket } = useRoomSocket();
  const { isLoading } = useRoomQuery(
    { id: '1' },
    {
      onSuccess: (data) => {
        setRoomInfo(data);
      }
    }
  );

  useEffect(() => {
    socket.emit(REQ_JOIN_ROOM, {
      roomId,
      uid: user?.id
    });

    // socket.on(RES_NEW_MEMBER, (member) => {
    //   console.log(RES_NEW_MEMBER, member);
    // });

    // socket.on(RES_MEMBER_LEFT, (socketID) => {
    //   console.log(RES_MEMBER_LEFT, socketID);
    // });
  }, [roomId, socket, user?.id]);

  return (
    <Layout title="Room">
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <Player roomId={roomId} />
        </>
      )}
    </Layout>
  );
};

export default RoomComponent;
