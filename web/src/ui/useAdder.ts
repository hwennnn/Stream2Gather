import { useCallback, useMemo, useRef, useState } from 'react';
import type { Media } from '../api/http';
import type { QueueMode, RoomSession, RoomView } from '../room/session';
import { mediaKey } from './rules';

export type AddStatus = 'idle' | 'adding' | 'added' | 'queued' | 'playing';

const ADDED_GRACE_MS = 3000;

/** Reworded here so a raw server sentence can't reach the add box. */
const friendly = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'That didn’t work. Try again.';
  return /not supported/i.test(message) ? 'That link isn’t supported. Paste a YouTube link.' : message;
};

export type Adder = {
  problem: string | null;
  clearProblem: () => void;
  statusOf: (media: Media) => AddStatus;
  addLink: (url: string) => Promise<boolean>;
  addMedia: (media: Media, mode: QueueMode) => Promise<boolean>;
};

/** Every way into the queue goes through here, so all of them answer the same way. */
export const useAdder = (session: RoomSession, view: RoomView): Adder => {
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const added = useRef(new Map<string, number>());

  const inQueue = useMemo(() => new Set(view.queue.slice(1).map(mediaKey)), [view.queue]);
  const playing = view.queue[0] ? mediaKey(view.queue[0]) : null;

  const statusOf = useCallback(
    (media: Media): AddStatus => {
      const key = mediaKey(media);
      if (adding.has(key)) return 'adding';
      const addedAt = added.current.get(key);
      const present = inQueue.has(key) || key === playing;
      if (addedAt !== undefined && (present || Date.now() - addedAt < ADDED_GRACE_MS)) return 'added';
      if (key === playing) return 'playing';
      return inQueue.has(key) ? 'queued' : 'idle';
    },
    [adding, inQueue, playing],
  );

  const addLink = useCallback(
    async (url: string) => {
      setProblem(null);
      try {
        await session.queueAdd({ url }, 'end');
        return true;
      } catch (error) {
        setProblem(friendly(error));
        return false;
      }
    },
    [session],
  );

  const addMedia = useCallback(
    async (media: Media, mode: QueueMode) => {
      const key = mediaKey(media);
      setProblem(null);
      setAdding((keys) => new Set(keys).add(key));
      try {
        await session.queueAdd({ media }, mode);
        added.current.set(key, Date.now());
        return true;
      } catch (error) {
        setProblem(friendly(error));
        return false;
      } finally {
        setAdding((keys) => {
          const next = new Set(keys);
          next.delete(key);
          return next;
        });
      }
    },
    [session],
  );

  const clearProblem = useCallback(() => setProblem(null), []);

  return { problem, clearProblem, statusOf, addLink, addMedia };
};
