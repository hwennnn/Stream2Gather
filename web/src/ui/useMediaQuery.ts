import { useMemo, useSyncExternalStore } from 'react';

export const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 500px)';
/** A short phone has no height to spare from chat, and a sideways one has no row under its seats. */
export const TRACK_IN_HEADER = '(max-width: 639px) and (min-height: 600px)';
/** Phones, upright or sideways: no row under the player, so no track there. */
export const NO_FRONT_ROW = `(max-width: 639px), ${PHONE_LANDSCAPE}`;

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
