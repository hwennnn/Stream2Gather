import { MutableRefObject } from 'react';
import { Socket } from 'socket.io-client';
import {
  CONNECT,
  REQ_JOIN_ROOM,
  REQ_PLAY_VIDEO,
  REQ_STREAMING_EVENTS,
  RES_MEMBER_LEFT,
  RES_NEW_MEMBER,
  RES_STREAMING_EVENTS
} from '../constants/socket';
import { RoomMember, User } from '../generated/graphql';
import {
  addActiveMember,
  removeActiveMember,
  setPlaying
} from '../store/useRoomStore';

export interface StreamEvent {
  roomId: string;
  isPlaying: boolean;
  timestamp: number;
}

export const joinRoom = (
  socket: Socket,
  roomId: string,
  user: User | null | undefined
): void => {
  socket.emit(REQ_JOIN_ROOM, {
    roomId,
    uid: user?.id,
    username: user?.username
  });
};

export const listenEvent = (socket: Socket): void => {
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

export const emitStreamEvent = (socket: Socket, payload: StreamEvent): void => {
  socket.emit(REQ_STREAMING_EVENTS, payload);
};

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

export const subscribeUserJoined = (socket: Socket): void => {
  socket.on(RES_NEW_MEMBER, (member: RoomMember) => {
    addActiveMember(member);
  });
};

export const subscribeUserLeft = (socket: Socket): void => {
  socket.on(RES_MEMBER_LEFT, (data) => {
    const { socketId } = data;
    removeActiveMember(socketId);
  });
};

export const startPlayingVideo = (socket: Socket): void => {
  socket.emit(REQ_PLAY_VIDEO, {
    playedTimestampUpdatedAt: new Date().getTime().toString(),
    isPlaying: true
  });
};
