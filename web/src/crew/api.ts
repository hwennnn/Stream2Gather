import { post, request, type Media, type RoomPreview } from '../api/http';

export type CrewLine = { slug: string; name: string; here: number };

export type WatchItem = { id: number; source: string; sourceId: string; addedAt: string; media: Media | null };

export type RosterEntry = { userId: string; name: string; avatarUrl?: string; joinedAt: string };

export type CrewDocument = RoomPreview & {
  ownerId: string;
  inviteToken: string;
  guestAccess: boolean;
  roster: RosterEntry[];
  watchlist: WatchItem[];
};

export type PastSession = {
  id: string;
  startedAt: string;
  endedAt: string;
  people: { name: string; isGuest: boolean }[];
  videos: { source: string; sourceId?: string; media: Media | null }[];
};

export type SessionPage = { items: PastSession[]; next?: string };

export type CrewEdit = { name?: string; guestAccess?: boolean; ownerId?: string };

const path = (slug: string) => `/v1/crews/${encodeURIComponent(slug)}`;
const patch = <T>(url: string, body: unknown) => request<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
const remove = (url: string) => request<unknown>(url, { method: 'DELETE' });

export const crewApi = {
  promote: (slug: string) => post<{ inviteToken: string }>(`/v1/rooms/${encodeURIComponent(slug)}/crew`),
  home: (slug: string) => request<CrewDocument>(path(slug)),
  join: (slug: string, token: string) => post<unknown>(`${path(slug)}/join`, { token }),
  edit: (slug: string, change: CrewEdit) => patch<unknown>(path(slug), change),
  close: (slug: string) => remove(path(slug)),
  rotate: (slug: string) => post<{ inviteToken: string }>(`${path(slug)}/invite`),
  removeMember: (slug: string, userId: string) => remove(`${path(slug)}/members/${encodeURIComponent(userId)}`),
  sessions: (slug: string, before?: string) =>
    request<SessionPage>(`${path(slug)}/sessions${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  watchlist: (slug: string) => request<{ items: WatchItem[] }>(`${path(slug)}/watchlist`),
  addWatch: (slug: string, video: { url: string }) => post<unknown>(`${path(slug)}/watchlist`, video),
  removeWatch: (slug: string, id: number) => remove(`${path(slug)}/watchlist/${id}`),
};

/** Survives the redirect back from sign-in, which can reload the page. */
export const WANTS_JOIN = 's2g:join-crew';

export const inviteLink = (slug: string, token: string) => `${window.location.origin}/r/${slug}?join=${token}`;
