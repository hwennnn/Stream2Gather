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

export type Person = { userId: string; name: string; role: 'host' | 'member' };

export type RoomPreview = {
  slug: string;
  name: string;
  nowPlaying: Media | null;
  members: Person[];
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
  ) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(response.status, problem?.code ?? 'unknown', problem?.message ?? 'Something went wrong. Try again.');
  }
  return (await response.json()) as T;
};

const post = <T>(path: string, body: unknown = {}) =>
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
  rename: (name: string) =>
    request<{ user: { id: string; name: string } }>('/v1/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
};
