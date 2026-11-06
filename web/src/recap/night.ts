import type { Moment } from '../catchup/api';
import { hueOf } from '../ui/people';

/** Around the moment itself, the lead-in and what people said just after. */
const BEFORE_MS = 10_000;
const AFTER_MS = 30_000;
const WORDS = 3;
const PLACES = 200;

export type Dot = { left: number; color: string };

/** A person's dots at one place on the line are one dot, so a burst doesn't draw a hundred. */
export const dotsOf = (moments: Moment[], lengthMs: number): Dot[] => {
  if (lengthMs <= 0) return [];
  const drawn = new Map<string, Dot>();
  for (const { posMs, userId, author } of moments) {
    const place = Math.min(Math.round((posMs / lengthMs) * PLACES), PLACES);
    drawn.set(`${place}:${userId ?? author}`, { left: (place / PLACES) * 100, color: userId ? hueOf(userId) : 'var(--color-dim)' });
  }
  return [...drawn.values()];
};

/** What people said at the moment. A reaction has no words, and the room's own lines are the memory. */
export const wordsAround = (moments: Moment[], posMs: number): Moment[] =>
  moments.filter(({ kind, origin, posMs: at }) => kind === 'chat' && origin === 'live' && at >= posMs - BEFORE_MS && at <= posMs + AFTER_MS).slice(0, WORDS);
