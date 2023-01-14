import create from 'zustand';

interface UserSettingsState {
  isTheatreMode: boolean;
  isMuted: boolean;
  volume: number;

  actions: {
    toggleTheatreMode: () => void;
    toggleMutedMode: () => void;
    setVolume: (volume: number) => void;
    resetUserSettings: () => void;
  };
}

const initialUserSettingsData = {
  isTheatreMode: false,
  isMuted: true,
  volume: 100
};

const useUserSettingsStore = create<UserSettingsState>()((set) => ({
  ...initialUserSettingsData,
  actions: {
    toggleTheatreMode: () => {
      set((state) => {
        return {
          isTheatreMode: !state.isTheatreMode
        };
      });
    },
    toggleMutedMode: () => {
      set((state) => {
        return {
          isMuted: !state.isMuted
        };
      });
    },
    setVolume: (volume: number) => {
      set({
        volume
      });
    },
    resetUserSettings: () => {
      set(initialUserSettingsData);
    }
  }
}));

// const useUserSettingsStore = create<UserSettingsState>()(
//   devtools(
//     persist((set) => ({
//       ...initialUserSettingsData,
//       actions: {
//         toggleTheatreMode: () => {
//           set((state) => {
//             return {
//               isTheatreMode: !state.isTheatreMode
//             };
//           });
//         },
//         toggleMutedMode: () => {
//           set((state) => {
//             return {
//               isMuted: !state.isMuted
//             };
//           });
//         },
//         setVolume: (volume: number) => {
//           set({
//             volume
//           });
//         },
//         resetUserSettings: () => {
//           set(initialUserSettingsData);
//         }
//       }
//     }))
//   )
// );

export const {
  toggleTheatreMode,
  toggleMutedMode,
  setVolume,
  resetUserSettings
} = useUserSettingsStore.getState().actions;

export default useUserSettingsStore;
