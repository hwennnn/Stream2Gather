import {
  FullRoomItemFragment,
  RoomInfo,
  RoomMember,
  VideoInfo
} from '@app/generated/graphql';
import create from 'zustand';

export enum RoomJoiningStatus {
  LOADING,
  SUCCESS,
  DOES_NOT_EXIST,
  INACTIVE,
  NO_PERMISSION,
  ALREADY_IN_ROOM,
  FAILED // Error Base Case
}

interface RoomState {
  roomId: string;
  roomSlug: string;
  status: RoomJoiningStatus;

  isActive: boolean;
  isPublic: boolean;
  isTemporary: boolean;
  activeMembers: RoomMember[];

  isMuted: boolean;
  volume: number;
  duration: number;

  // Room Info
  playing: boolean;
  playedSeconds: number;
  playedTimestampUpdatedAt: string;

  playingIndex: number;
  playlist: VideoInfo[];
  currentVideo: VideoInfo | undefined;

  actions: {
    setRoom: (data: FullRoomItemFragment) => void;
    resetRoom: () => void;
    setRoomJoiningStatus: (status: RoomJoiningStatus) => void;
    setPlaying: (playing: boolean) => void;
    setIsMuted: (isMuted: boolean) => void;
    setVolume: (volume: number) => void;

    setPlayedSeconds: (playedSeconds: number) => void;
    setDuration: (duration: number) => void;
    setPlayingIndex: (playingIndex: number) => void;
    setPlaylist: (playlist: VideoInfo[]) => void;
    setCurrentVideo: (currentvideo: VideoInfo) => void;
    addToPlaylist: (videoInfo: VideoInfo) => void;
    updateRoomInfo: (roomInfo: RoomInfo) => void;

    addActiveMember: (member: RoomMember) => void;
    removeActiveMember: (socketId: string) => void;
  };
}

const initialRoomData = {
  roomId: '',
  roomSlug: '',
  status: RoomJoiningStatus.LOADING,
  isActive: true,
  isTemporary: true,
  isPublic: false,
  activeMembers: [],
  isMuted: true,
  volume: 100,
  duration: 0,
  playing: false,
  playedSeconds: 0,
  playedTimestampUpdatedAt: '0',
  playingIndex: 0,
  playlist: [],
  currentVideo: undefined
};

const useRoomStore = create<RoomState>()((set) => ({
  ...initialRoomData,
  actions: {
    setRoom: (data: FullRoomItemFragment) => {
      const roomInfo = data.roomInfo;
      set({
        roomId: data.id,
        roomSlug: data.slug,
        isActive: data.isActive,
        isTemporary: data.isTemporary,
        isPublic: data.isPublic,
        activeMembers: data.activeMembers,
        playing: roomInfo.isPlaying,
        playedSeconds: roomInfo.playedSeconds,
        playedTimestampUpdatedAt: roomInfo.playedTimestampUpdatedAt,
        playingIndex: roomInfo.playingIndex,
        playlist: roomInfo.playlist,
        currentVideo: roomInfo.playlist[roomInfo.playingIndex]
      });
    },
    resetRoom: () => set({ ...initialRoomData }),
    setRoomJoiningStatus: (status) => set({ status }),
    setPlaying: (playing) => set({ playing }),
    setIsMuted: (isMuted) => set({ isMuted }),
    setVolume: (volume) => set({ volume }),
    setPlayedSeconds: (playedSeconds) => set({ playedSeconds }),
    setDuration: (duration) => set({ duration }),
    setPlayingIndex: (playingIndex) => set({ playingIndex }),
    setPlaylist: (playlist) => set({ playlist }),
    setCurrentVideo: (currentVideo) => set({ currentVideo }),
    addActiveMember: (member) =>
      set((state) => {
        const activeMembers = [...state.activeMembers, member];
        return { activeMembers };
      }),
    removeActiveMember: (socketId) =>
      set((state) => {
        const activeMembers = state.activeMembers.filter(
          (m) => m.socketId !== socketId
        );
        return { activeMembers };
      }),
    addToPlaylist: (videoInfo) =>
      set((state) => {
        const playlist = [...state.playlist, videoInfo];
        return { playlist };
      }),
    updateRoomInfo: (roomInfo) =>
      set((_) => {
        return {
          playlist: roomInfo.playlist,
          playing: roomInfo.isPlaying,
          playedSeconds: roomInfo.playedSeconds,
          playedTimestampUpdatedAt: roomInfo.playedTimestampUpdatedAt,
          playingIndex: roomInfo.playingIndex,
          currentVideo: roomInfo.currentVideo
        };
      })
  }
}));

export const {
  setRoom,
  resetRoom,
  setRoomJoiningStatus,
  setPlaying,
  setIsMuted,
  setVolume,
  setPlayedSeconds,
  setDuration,
  setPlayingIndex,
  setPlaylist,
  setCurrentVideo,
  addActiveMember,
  removeActiveMember,
  addToPlaylist,
  updateRoomInfo
} = useRoomStore.getState().actions;

export default useRoomStore;
