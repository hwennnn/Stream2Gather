import { api } from '../api/http';

export const navigate = (path: string, state?: unknown) => {
  window.history.pushState(state ?? null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export const loadRoomPage = () => import('./RoomPage');

export type Route =
  | { page: 'landing' }
  | { page: 'room'; slug: string }
  | { page: 'catchup'; slug: string; itemId: string }
  | { page: 'recap'; token: string };

export const routeFor = (path: string): Route => {
  const [, kind, id, section, itemId] = path.split('/');
  if (kind === 's' && id) return { page: 'recap', token: id };
  if (kind !== 'r' || !id) return { page: 'landing' };
  return section === 'catchup' && itemId ? { page: 'catchup', slug: id, itemId } : { page: 'room', slug: id };
};

const copyLink = async (slug: string) => {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/r/${slug}`);
    return true;
  } catch {
    return false; // Some browsers refuse; the room's Invite button still works.
  }
};

/** Creates a room and walks straight in, with its link already on the clipboard. */
export const startRoom = async (url?: string): Promise<void> => {
  const room = await api.createRoom(url);
  const copied = await copyLink(room.slug);
  navigate(`/r/${room.slug}`, { joined: true, copied });
};
