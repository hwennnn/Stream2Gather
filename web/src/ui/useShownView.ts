import { useRef } from 'react';

/** A hidden panel keeps the room it last showed, so the room's traffic can't redraw it. */
export const useShownView = <T>(view: T, shown: boolean): T => {
  const last = useRef(view);
  if (shown) last.current = view;
  return last.current;
};
