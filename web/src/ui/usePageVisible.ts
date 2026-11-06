import { useSyncExternalStore } from 'react';

export const usePageVisible = (): boolean =>
  useSyncExternalStore(
    (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    () => document.visibilityState === 'visible',
  );
