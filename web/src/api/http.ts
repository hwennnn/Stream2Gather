export type Media = {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  durationMs: number;
  isLive: boolean;
};

export type VoiceState = 'listening' | 'muted' | 'live';

export type Person = {
  userId: string;
  name: string;
  role: 'host' | 'member';
  avatarUrl?: string;
  /** On the room's crew roster. */
  member?: boolean;
  voice?: VoiceState;
  /** When they arrived. */
  since?: number;
};

export type Account = { id: string; name: string; avatarUrl: string; signedIn: boolean };

export type RoomPreview = {
  slug: string;
  name: string;
  nowPlaying: Media | null;
  /** Where the room is right now, or null when nothing is playing. */
  playback: { status: string; pos: number } | null;
  members: Person[];
  maxMembers: number;
  /** Absent for a room with no crew. */
  crew?: { memberCount: number; isMember: boolean; guestAccess: boolean };
};

export type SiteConfig = {
  clerkPublishableKey: string;
  sources: string[];
  voice: boolean;
  vapidPublicKey: string;
  twitchParent: string;
};

export type ChatMessage = {
  id: number;
  userId: string;
  author: string;
  body: string;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** How long the server asked us to wait before trying again. */
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

const reach = async (path: string, init?: RequestInit): Promise<Response> => {
  try {
    return await fetch(path, {
      ...init,
      headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Try again.');
  }
};

export const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await reach(path, init);
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    const retryAfter = (Number(response.headers.get('retry-after')) || 0) * 1000;
    throw new ApiError(response.status, problem?.code ?? 'unknown', problem?.message ?? 'Something went wrong. Try again.', retryAfter);
  }
  return (await response.json()) as T;
};

type Session = { user: Account | null };

export const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  createRoom: (url?: string) => post<{ slug: string; name: string }>('/v1/rooms', { url }),
  preview: (slug: string) => request<RoomPreview>(`/v1/rooms/${encodeURIComponent(slug)}`),
  ticket: (slug: string) => post<{ ticket: string }>(`/v1/rooms/${encodeURIComponent(slug)}/ticket`),
  messages: (slug: string) =>
    request<{ items: ChatMessage[] }>(`/v1/rooms/${encodeURIComponent(slug)}/messages`),
  search: (query: string) =>
    request<{ items: Media[] }>(`/v1/media/search?q=${encodeURIComponent(query)}`),
  trending: () => request<{ items: Media[] }>('/v1/media/trending'),
  rename: (name: string) => request<Session>('/v1/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
  config: () => request<SiteConfig>('/v1/config'),
  me: () => request<Session>('/v1/me'),
  clerkSession: (token: string) =>
    request<Session>('/v1/session/clerk', { method: 'POST', headers: { authorization: `Bearer ${token}` } }),
  signOut: () => request<Session>('/v1/session', { method: 'DELETE' }),
};
