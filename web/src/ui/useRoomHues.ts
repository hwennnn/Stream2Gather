import { useEffect, useMemo, useRef } from 'react';
import type { Person } from '../api/http';
import { AVATAR_COLORS, roomHues, usualHue, type Hues } from './people';

const stepsApart = (a: number, b: number): number => {
  const steps = Math.abs(a - b);
  return Math.min(steps, AVATAR_COLORS.length - steps);
};

/** Neighbours on the wheel pass for each other across a row, so one step away isn't far enough. */
const CLEAR = 2;

const hueBeside = (preferred: number, taken: number[]): number => {
  const clearance = (hue: number) => Math.min(AVATAR_COLORS.length, ...taken.map((other) => stepsApart(hue, other)));
  if (clearance(preferred) >= CLEAR) return preferred;
  const hues = AVATAR_COLORS.map((_, hue) => hue).sort((a, b) => stepsApart(a, preferred) - stepsApart(b, preferred));
  return hues.reduce((best, hue) => (clearance(hue) > clearance(best) ? hue : best), preferred);
};

/**
 * Everyone here keeps the colour they have, and a newcomer gets their usual one unless someone
 * in the room looks like it. Then they get whichever stands furthest from everyone. A room with
 * more people than colours has to repeat one.
 */
export const placeHues = (kept: Hues, people: string[]): Hues => {
  const taken: number[] = [];
  const next = { ...kept };
  const newcomers = people.filter((userId) => {
    const hue = kept[userId];
    if (hue === undefined || taken.includes(hue)) return true;
    taken.push(hue);
    return false;
  });
  for (const userId of newcomers) {
    const hue = hueBeside(usualHue(userId), taken);
    next[userId] = hue;
    taken.push(hue);
  }
  return next;
};

const show = (hues: Hues) => {
  roomHues.clear();
  for (const [userId, hue] of Object.entries(hues)) roomHues.set(userId, hue);
};

const keyFor = (slug: string) => `s2g:hues:${slug}`;

const remembered = (slug: string): Hues => {
  try {
    return JSON.parse(window.sessionStorage.getItem(keyFor(slug)) ?? '{}') as Hues;
  } catch {
    return {};
  }
};

/**
 * Keeps everyone in the room a colour of their own. Nobody's colour changes while they're here,
 * and this tab remembers them through a reload, when the people who shaped them may have gone.
 */
export const useRoomHues = (slug: string, members: Pick<Person, 'userId'>[]) => {
  const kept = useRef<Hues | null>(null);
  const hues = useMemo(() => {
    kept.current = placeHues(kept.current ?? remembered(slug), members.map(({ userId }) => userId));
    return kept.current;
  }, [slug, members]);
  // Here rather than in an effect: the seats drawn in this same pass have to read it.
  show(hues);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(keyFor(slug), JSON.stringify(hues));
    } catch {
      // Private windows can refuse. The colours still hold until a reload.
    }
  }, [slug, hues]);

  useEffect(() => () => roomHues.clear(), []);
};
