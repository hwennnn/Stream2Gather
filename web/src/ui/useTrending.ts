import { useEffect, useState } from 'react';
import { api, type Media } from '../api/http';
import { viewerRegion } from './region';

const STORE_KEY = 's2g:trending';
const STORE_LIFE_MS = 30 * 60_000;

const remembered = (): Media[] | null => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null') as { at: number; items: Media[] } | null;
    return saved && Date.now() - saved.at < STORE_LIFE_MS ? saved.items : null;
  } catch {
    return null;
  }
};

let loading: Promise<Media[]> | null = null;

const load = (): Promise<Media[]> => {
  loading ??= api.trending(viewerRegion(navigator.language)).then(
    ({ items }) => {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), items }));
      } catch {
        // A full or blocked store only costs a refetch.
      }
      return items;
    },
    () => {
      loading = null;
      return [];
    },
  );
  return loading;
};

/** Null until the first answer. Empty means there is nothing to show. */
export const useTrending = (): Media[] | null => {
  const [items, setItems] = useState(remembered);

  useEffect(() => {
    if (items) return undefined;
    let live = true;
    void load().then((next) => {
      if (live) setItems(next);
    });
    return () => {
      live = false;
    };
  }, [items]);

  return items;
};

/** Suggestions the room could still act on. What's playing or queued isn't one. */
export const notInRoom = (items: Media[] | null, queue: { sourceId: string }[]): Media[] | null =>
  items && items.filter((media) => !queue.some((item) => item.sourceId === media.sourceId));
