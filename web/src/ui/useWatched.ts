import { useRef } from 'react';
import type { QueueItem, RoomView } from '../room/session';

/** What this tab has seen the room play, for the credits when the queue runs out. A reload starts it again. */
export const useWatched = (view: RoomView): QueueItem[] => {
  const watched = useRef<QueueItem[]>([]);
  const current = view.queue[0];
  if (current && !watched.current.some(({ id }) => id === current.id)) watched.current = [...watched.current, current];
  return watched.current;
};
