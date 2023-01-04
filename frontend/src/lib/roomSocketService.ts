import {
  CONNECT,
  REQ_JOIN_ROOM,
  REQ_PLAY_VIDEO,
  REQ_STREAMING_EVENTS,
  RES_JOINED_ROOM,
  RES_JOIN_ROOM_FAILED,
  RES_MEMBER_LEFT,
  RES_NEW_MEMBER,
  RES_ROOM_DOES_NOT_EXIST,
  RES_ROOM_INACTIVE,
  RES_ROOM_NO_PERMISSION,
  RES_STREAMING_EVENTS
} from '@app/constants/socket';
import { RoomMember } from '@app/generated/graphql';
import {
  addActiveMember,
  removeActiveMember,
  RoomJoiningStatus,
  setPlaying,
  setRoomJoiningStatus
} from '@app/store/useRoomStore';
import { MutableRefObject } from 'react';
import { Socket } from 'socket.io-client';

export interface StreamEvent {
  roomId: string;
  isPlaying: boolean;
  timestamp: number;
}

const handleJoinRoom = (
  socket: Socket,
  slug: string,
  uid: string,
  username: string
): void => {
  socket.emit(REQ_JOIN_ROOM, {
    slug,
    uid,
    username
  });
};

export const emitStreamEvent = (socket: Socket, payload: StreamEvent): void => {
  socket.emit(REQ_STREAMING_EVENTS, payload);
};

export const startPlayingVideo = (socket: Socket): void => {
  socket.emit(REQ_PLAY_VIDEO, {
    playedTimestampUpdatedAt: new Date().getTime().toString(),
    isPlaying: true
  });
};

// Only listen to this event once the player is ready
export const subscribeStreamEvent = (
  socket: Socket,
  playerRef: MutableRefObject<any>
): void => {
  socket.on(RES_STREAMING_EVENTS, (videoEvent) => {
    // console.log(RES_STREAMING_EVENTS, videoEvent);
    const { isPlaying, playedSeconds } = videoEvent;

    setPlaying(isPlaying);
    playerRef.current.seekTo(playedSeconds, 'seconds');
  });
};

const listenEvent = (socket: Socket): void => {
  if (process.env.NODE_ENV !== 'production') {
    socket.on(CONNECT, () => {
      console.log('Room socket connected!', socket.id);
    });

    const listener = (eventName: string, ...args: any): void => {
      console.log(eventName, args);
    };

    socket.onAny(listener);
  }
};

const handleJoinedRoom = (socket: Socket): void => {
  socket.on(RES_JOINED_ROOM, () => {
    setRoomJoiningStatus(RoomJoiningStatus.SUCCESS);
  });
};

const handleRoomDoesNotExist = (socket: Socket): void => {
  socket.on(RES_ROOM_DOES_NOT_EXIST, () => {
    setRoomJoiningStatus(RoomJoiningStatus.DOES_NOT_EXIST);
  });
};

const handleRoomInactive = (socket: Socket): void => {
  socket.on(RES_ROOM_INACTIVE, () => {
    setRoomJoiningStatus(RoomJoiningStatus.INACTIVE);
  });
};

const handleRoomNoPermission = (socket: Socket): void => {
  socket.on(RES_ROOM_NO_PERMISSION, () => {
    setRoomJoiningStatus(RoomJoiningStatus.NO_PERMISSION);
  });
};

const handleJoinRoomFailed = (socket: Socket): void => {
  socket.on(RES_JOIN_ROOM_FAILED, () => {
    setRoomJoiningStatus(RoomJoiningStatus.FAILED);
  });
};

const handleNewMember = (socket: Socket): void => {
  socket.on(RES_NEW_MEMBER, (member: RoomMember) => {
    addActiveMember(member);
  });
};

const handleMemberLeft = (socket: Socket): void => {
  socket.on(RES_MEMBER_LEFT, (data) => {
    const { socketId } = data;
    removeActiveMember(socketId);
  });
};

export const initSocketForRoom = (
  socket: Socket,
  slug: string,
  uid: string,
  username: string
): void => {
  listenEvent(socket);
  handleJoinRoom(socket, slug, uid, username);
  handleJoinedRoom(socket);
  handleRoomDoesNotExist(socket);
  handleRoomInactive(socket);
  handleRoomNoPermission(socket);
  handleJoinRoomFailed(socket);
  handleNewMember(socket);
  handleMemberLeft(socket);
};
