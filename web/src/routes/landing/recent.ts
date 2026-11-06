import { useEffect, useState } from 'react';
import { api, type Person } from '../../api/http';

const KEY = 's2g:recent-room';

type Saved = { slug: string; name: string };
export type RecentRoom = Saved & { members: Person[] };

export const rememberRoom = (slug: string, name: string): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ slug, name }));
  } catch {
    // A private window can refuse storage. The way back is a nicety.
  }
};

const saved = (): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
  } catch {
    return null;
  }
};

/** The room this browser was last in, if it's still there, and who's in it now. */
export const useRecentRoom = (): RecentRoom | null => {
  const [room, setRoom] = useState<RecentRoom | null>(null);
  useEffect(() => {
    const last = saved();
    if (!last) return undefined;
    let live = true;
    api
      .preview(last.slug)
      .then((preview) => {
        if (live) setRoom({ slug: last.slug, name: preview.name, members: preview.members });
      })
      .catch(() => localStorage.removeItem(KEY));
    return () => {
      live = false;
    };
  }, []);
  return room;
};
