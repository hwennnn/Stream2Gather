import { useMemo, useSyncExternalStore } from 'react';

export const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 500px)';

export const useMediaQuery = (query: string): boolean => {
  const list = useMemo(() => window.matchMedia(query), [query]);
  return useSyncExternalStore(
    (listener) => {
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => list.matches,
  );
};
