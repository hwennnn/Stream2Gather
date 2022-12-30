import create from 'zustand';
import { RoomQuery } from './../generated/graphql';

interface RoomState {
  playing: boolean;
  isMuted: boolean;
  playingUrl: string;
  playedSeconds: number;
  duration: number;
  playedTimestampUpdatedAt: string;

  actions: {
    setRoomInfo: (data: RoomQuery) => void;
    setPlaying: (playing: boolean) => void;
    setIsMuted: (isMuted: boolean) => void;
    setPlayingUrl: (playingUrl: string) => void;
    setPlayedSeconds: (playedSeconds: number) => void;
    setDuration: (duration: number) => void;
  };
}

const initialRoomData = {
  playing: false,
  isMuted: true,
  playingUrl: 'https://youtu.be/Y8JFxS1HlDo',
  playedSeconds: 0,
  duration: 0,
  playedTimestampUpdatedAt: '0'
};

const useRoomStore = create<RoomState>()((set) => ({
  ...initialRoomData,
  actions: {
    setRoomInfo: (data: RoomQuery) => {
      const roomInfo = data.room?.roomInfo;
      set({
        playing: roomInfo?.isPlaying,
        playingUrl: roomInfo?.currentUrl,
        playedSeconds: roomInfo?.playedSeconds
      });
    },
    setPlaying: (playing) => set({ playing }),
    setIsMuted: (isMuted) => set({ isMuted }),
    setPlayingUrl: (playingUrl) => set({ playingUrl }),
    setPlayedSeconds: (playedSeconds) => set({ playedSeconds }),
    setDuration: (duration) => set({ duration })
  }
}));

export const {
  setRoomInfo,
  setPlaying,
  setIsMuted,
  setPlayingUrl,
  setPlayedSeconds,
  setDuration
} = useRoomStore.getState().actions;

export default useRoomStore;
