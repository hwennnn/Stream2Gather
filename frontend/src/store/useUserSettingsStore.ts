import create from 'zustand';
import { devtools, persist } from 'zustand/middleware';

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
  isMuted: false,
  volume: 100
};

const useUserSettingsStore = create<UserSettingsState>()(
  devtools(
    persist((set) => ({
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
    }))
  )
);

export const {
  toggleTheatreMode,
  toggleMutedMode,
  setVolume,
  resetUserSettings
} = useUserSettingsStore.getState().actions;

export default useUserSettingsStore;
