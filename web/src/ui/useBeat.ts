import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '../room/session';

/**
 * A moment the whole row reacts to. It starts at someone's seat and passes along
 * the row from there, so the room is seen noticing what they did.
 */
export type Beat = { kind: 'arrive' | 'leave' | 'hold' | 'go' | 'act'; from: string[] };

/** As long as the last seat's turn takes, at the far end of a full row. */
const BEAT_MS = 900;

const KINDS = new Map<string, Beat['kind']>([
  ['pause', 'hold'],
  ['play', 'go'],
  ['seek', 'act'],
  ['skip', 'act'],
  ['queue.play', 'act'],
]);

/** Who moved, and how the row should take it. Nothing here runs on a timer but the beat's own end. */
export const useBeat = (view: RoomView): Beat | null => {
  // Walking in is a beat too: you sit down, and the row looks round.
  const [beat, setBeat] = useState<Beat | null>(view.self ? { kind: 'arrive', from: [view.self.userId] } : null);
  const timer = useRef<number | undefined>(undefined);
  const seen = useRef<Set<string> | null>(null);
  const action = useRef(view.lastAction);

  const play = (kind: Beat['kind'], from: string[]) => {
    window.clearTimeout(timer.current);
    // People arrive in clumps. They share one beat rather than each restarting the row.
    setBeat((now) => (now?.kind === kind ? { kind, from: [...now.from, ...from] } : { kind, from }));
    timer.current = window.setTimeout(() => setBeat(null), BEAT_MS);
  };

  useEffect(() => {
    timer.current = window.setTimeout(() => setBeat(null), BEAT_MS);
    return () => window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    const now = new Set(view.members.map(({ userId }) => userId));
    const before = seen.current;
    if (now.size > 0) seen.current = now;
    if (!before) return;
    const came = [...now].filter((id) => !before.has(id));
    const went = [...before].filter((id) => !now.has(id));
    if (came.length > 0) play('arrive', came);
    else if (went.length > 0) play('leave', went);
  }, [view.members]);

  useEffect(() => {
    const next = view.lastAction;
    if (next === action.current) return;
    action.current = next;
    const kind = next && KINDS.get(next.cause);
    if (!next || !kind) return;
    const person = view.members.find(({ name }) => name === next.by);
    play(kind, person ? [person.userId] : []);
    // Only an action starts a beat, and the members it reads then are the current ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.lastAction]);

  return beat;
};

/** Each seat's place in the beat: how many seats from where it started, and which way that is. */
export const beatAt = (index: number, origins: number[]): { dist: number; toward: number } => {
  const nearest = origins.reduce<number | null>((best, at) => (best === null || Math.abs(at - index) < Math.abs(best - index) ? at : best), null);
  if (nearest === null) return { dist: 0, toward: 0 };
  return { dist: Math.abs(nearest - index), toward: Math.sign(nearest - index) };
};
