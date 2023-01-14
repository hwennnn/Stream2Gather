import {
  CONNECT,
  REQ_ADD_TO_PLAYLIST,
  REQ_ADD_VIDEO_ID_TO_PLAYLIST,
  REQ_JOIN_ROOM,
  REQ_PLAY_EXISTING_VIDEO,
  REQ_PLAY_NEW_VIDEO,
  REQ_PLAY_NEXT_VIDEO,
  REQ_PLAY_VIDEO,
  REQ_REMOVE_FROM_PLAYLIST,
  REQ_RESET_QUEUE,
  REQ_SEND_MESSAGE,
  REQ_STREAMING_EVENTS,
  RES_JOINED_ROOM,
  RES_JOIN_ROOM_FAILED,
  RES_MEMBER_LEFT,
  RES_NEW_MEMBER,
  RES_NEW_MESSAGE,
  RES_ROOM_ALREADY_FULL,
  RES_ROOM_ALREADY_JOINED,
  RES_ROOM_DOES_NOT_EXIST,
  RES_ROOM_INACTIVE,
  RES_ROOM_INFO,
  RES_ROOM_NO_PERMISSION,
  RES_STREAMING_EVENTS,
  RoomInfoType
} from '@app/constants/socket';
import { RoomMember, VideoInfo } from '@app/generated/graphql';
import {
  addActiveMember,
  addToPlaylist,
  pushRoomMessage,
  removeActiveMember,
  RoomJoiningStatus,
  setPlaying,
  setRoomJoiningStatus,
  updateRoomInfo
} from '@app/store/useRoomStore';
import { MutableRefObject } from 'react';
import { Socket } from 'socket.io-client';

export interface StreamEvent {
  isPlaying: boolean;
  timestamp: number;
}

const handleJoinRoom = (
  socket: Socket,
  slug: string,
  uid: string,
  username: string,
  invitationCode: string | undefined
): void => {
  socket.emit(REQ_JOIN_ROOM, {
    slug,
    uid,
    username,
    invitationCode
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
    const { isPlaying, playedSeconds } = videoEvent;

    setPlaying(isPlaying);
    playerRef.current.seekTo(playedSeconds, 'seconds');
  });
};

export const addVideoIdToPlaylist = (socket: Socket, videoId: string): void => {
  socket.emit(REQ_ADD_VIDEO_ID_TO_PLAYLIST, { videoId });
};

export const addToPlayList = (socket: Socket, videoInfo: VideoInfo): void => {
  socket.emit(REQ_ADD_TO_PLAYLIST, { videoInfo });
};

export const removeFromPlayList = (
  socket: Socket,
  removingIndex: number
): void => {
  socket.emit(REQ_REMOVE_FROM_PLAYLIST, { removingIndex });
};

export const playNewVideo = (socket: Socket, videoInfo: VideoInfo): void => {
  socket.emit(REQ_PLAY_NEW_VIDEO, { videoInfo });
};

export const resetQueue = (socket: Socket): void => {
  socket.emit(REQ_RESET_QUEUE);
};

export const playNextVideo = (socket: Socket, playingIndex: number): void => {
  socket.emit(REQ_PLAY_NEXT_VIDEO, { playingIndex });
};

export const playExistingVideo = (
  socket: Socket,
  playingIndex: number
): void => {
  socket.emit(REQ_PLAY_EXISTING_VIDEO, { playingIndex });
};

export const sendMessage = (socket: Socket, content: string): void => {
  socket.emit(REQ_SEND_MESSAGE, { content });
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

const handleAlreadyInRoom = (socket: Socket): void => {
  socket.on(RES_ROOM_ALREADY_JOINED, () => {
    setRoomJoiningStatus(RoomJoiningStatus.ALREADY_IN_ROOM);
  });
};

const handleRoomAlreadyFull = (socket: Socket): void => {
  socket.on(RES_ROOM_ALREADY_FULL, () => {
    setRoomJoiningStatus(RoomJoiningStatus.ALREADY_FULL);
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

const handleRoomInfoUpdate = (socket: Socket): void => {
  socket.on(RES_ROOM_INFO, (data) => {
    switch (data.type) {
      case RoomInfoType.ADD_TO_QUEUE:
        addToPlaylist(data.videoInfo);
        break;
      case RoomInfoType.RESET_QUEUE:
      case RoomInfoType.UPDATE_PLAYLIST:
      case RoomInfoType.UPDATE_PLAYING_INDEX:
        updateRoomInfo(data.roomInfo);
        break;
      default:
        break;
    }
  });
};

const handleNewMessage = (socket: Socket): void => {
  socket.on(RES_NEW_MESSAGE, (data) => {
    const { message } = data;
    pushRoomMessage(message);
  });
};

export const initSocketForRoom = (
  socket: Socket,
  slug: string,
  uid: string,
  username: string,
  invitationCode: string | undefined
): void => {
  listenEvent(socket);
  handleJoinRoom(socket, slug, uid, username, invitationCode);
  handleJoinedRoom(socket);
  handleRoomDoesNotExist(socket);
  handleRoomInactive(socket);
  handleRoomNoPermission(socket);
  handleAlreadyInRoom(socket);
  handleRoomAlreadyFull(socket);
  handleJoinRoomFailed(socket);
  handleNewMember(socket);
  handleMemberLeft(socket);
  handleRoomInfoUpdate(socket);
  handleNewMessage(socket);
};
