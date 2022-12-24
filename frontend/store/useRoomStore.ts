import create from "zustand";

interface RoomState {
    playing: boolean;
    isMuted: boolean;
    playingUrl: string;
    playedSeconds: number;
    duration: number;

    setPlaying: (playing: boolean) => void;
    setIsMuted: (isMuted: boolean) => void;
    setPlayingUrl: (playingUrl: string) => void;
    setPlayedSeconds: (playedSeconds: number) => void;
    setDuration: (duration: number) => void;
}

const useRoomStore = create<RoomState>()((set) => ({
    playing: false,
    isMuted: false,
    playingUrl: "https://youtu.be/Y8JFxS1HlDo",
    playedSeconds: 0,
    duration: 0,
    setPlaying: (playing) => set({ playing }),
    setIsMuted: (isMuted) => set({ isMuted }),
    setPlayingUrl: (playingUrl) => set({ playingUrl }),
    setPlayedSeconds: (playedSeconds) => set({ playedSeconds }),
    setDuration: (duration) => set({ duration }),
}));

// TO PERSIST STATE
// const useRoomStore = create<RoomState>()(
//     devtools(
//         persist(
//             (set) => ({
//                 playing: false,
//                 isMuted: false,
//                 playingUrl: "https://youtu.be/Y8JFxS1HlDo",
//                 playedSeconds: 0,
//                 duration: 0,
//                 setPlaying: (playing) => set({ playing }),
//                 setIsMuted: (isMuted) => set({ isMuted }),
//                 setPlayingUrl: (playingUrl) => set({ playingUrl }),
//                 setPlayedSeconds: (playedSeconds) => set({ playedSeconds }),
//                 setDuration: (duration) => set({ duration }),
//             }),
//             {
//                 name: "room-storage",
//             }
//         )
//     )
// );

export default useRoomStore;
