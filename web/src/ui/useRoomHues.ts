import { useEffect, useMemo, useRef } from 'react';
import type { Person } from '../api/http';
import { placeHues, setRoomHues, type Hues } from './people';

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
  setRoomHues(hues);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(keyFor(slug), JSON.stringify(hues));
    } catch {
      // Private windows can refuse. The colours still hold until a reload.
    }
  }, [slug, hues]);

  useEffect(() => () => setRoomHues({}), []);
};
