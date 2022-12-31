import create from 'zustand';
import { RoomMember, RoomQuery, VideoInfo } from './../generated/graphql';

interface RoomState {
  roomId: string;
  isPublic: boolean;
  isMuted: boolean;
  activeMembers: RoomMember[];

  // Room Info
  playing: boolean;
  playingUrl: string;
  playedSeconds: number;
  duration: number;
  playedTimestampUpdatedAt: string;
  playingIndex: number;
  playlist: VideoInfo[];

  actions: {
    setRoom: (data: RoomQuery) => void;
    setPlaying: (playing: boolean) => void;
    setIsMuted: (isMuted: boolean) => void;
    setPlayingUrl: (playingUrl: string) => void;
    setPlayedSeconds: (playedSeconds: number) => void;
    setDuration: (duration: number) => void;
    setPlayingIndex: (playingIndex: number) => void;
    setPlaylist: (playlist: VideoInfo[]) => void;
    addActiveMember: (member: RoomMember) => void;
    removeActiveMember: (socketId: string) => void;
  };
}

const initialRoomData = {
  roomId: '',
  isPublic: false,
  playing: false,
  isMuted: true,
  playingUrl: 'https://youtu.be/Y8JFxS1HlDo',
  playedSeconds: 0,
  duration: 0,
  playedTimestampUpdatedAt: '0',
  playingIndex: 0,
  playlist: [],
  activeMembers: []
};

const useRoomStore = create<RoomState>()((set) => ({
  ...initialRoomData,
  actions: {
    setRoom: (data: RoomQuery) => {
      const roomInfo = data.room?.roomInfo;
      set({
        roomId: data.room?.id,
        activeMembers: data.room?.activeMembers,
        isPublic: data.room?.isPublic,
        playing: roomInfo?.isPlaying,
        playingUrl: roomInfo?.currentUrl,
        playedSeconds: roomInfo?.playedSeconds,
        playedTimestampUpdatedAt: roomInfo?.playedTimestampUpdatedAt,
        playingIndex: roomInfo?.playingIndex,
        playlist: roomInfo?.playlist
      });
    },
    setPlaying: (playing) => set({ playing }),
    setIsMuted: (isMuted) => set({ isMuted }),
    setPlayingUrl: (playingUrl) => set({ playingUrl }),
    setPlayedSeconds: (playedSeconds) => set({ playedSeconds }),
    setDuration: (duration) => set({ duration }),
    setPlayingIndex: (playingIndex) => set({ playingIndex }),
    setPlaylist: (playlist) => set({ playlist }),
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
        console.log('removeActiveMember', socketId, activeMembers);
        return { activeMembers };
      })
  }
}));

export const {
  setRoom,
  setPlaying,
  setIsMuted,
  setPlayingUrl,
  setPlayedSeconds,
  setDuration,
  setPlayingIndex,
  setPlaylist,
  addActiveMember,
  removeActiveMember
} = useRoomStore.getState().actions;

export default useRoomStore;
