import { api } from '../api/http';

export const navigate = (path: string, state?: unknown) => {
  window.history.pushState(state ?? null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export const loadRoomPage = () => import('./RoomPage');

export type Route =
  | { page: 'landing' }
  | { page: 'missing' }
  | { page: 'room'; slug: string }
  | { page: 'catchup'; slug: string; itemId: string }
  | { page: 'recap'; token: string };

/** A cut-off room or recap link still lands somewhere useful. The server's appPath keeps to this. */
const LANDING = new Set(['', 'r', 's', 'index.html']);

export const routeFor = (path: string): Route => {
  const [, kind = '', id, section, itemId] = path.split('/');
  if (kind === 's' && id) return { page: 'recap', token: id };
  if (kind !== 'r' || !id) return LANDING.has(kind) ? { page: 'landing' } : { page: 'missing' };
  return section === 'catchup' && itemId ? { page: 'catchup', slug: id, itemId } : { page: 'room', slug: id };
};

/** Creates a room and walks straight in. Copying the link waits until someone asks. */
export const startRoom = async (url?: string): Promise<void> => {
  const room = await api.createRoom(url);
  navigate(`/r/${room.slug}`, { joined: true });
};
