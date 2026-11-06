import { post, request, type Media } from '../api/http';

export type RecapPerson = { name: string; isGuest: boolean };

export type RecapVideo = { source: string; sourceId: string; reactions: number; media: Media | null };

export type Biggest = { source: string; sourceId: string; posMs: number; emojis: Record<string, number>; people: number; media: Media | null; itemId?: number };

export type Recap = {
  sessionId: string;
  startedAt: string;
  building?: boolean;
  wallMs: number;
  people: RecapPerson[];
  items: RecapVideo[];
  reactions: Record<string, number>;
  biggest: Biggest | null;
  attended: boolean;
  shareUrl?: string;
};

export type PublicRecap = {
  crewName: string;
  startedAt: string;
  wallMs: number;
  people: string[];
  videos: { title: string; url: string; thumbnailUrl?: string; reactions: number }[];
  reactions: Record<string, number>;
  biggest: { title: string; posMs: number; emojis: Record<string, number>; people: number } | null;
};

const path = (slug: string, sessionId: string) =>
  `/v1/crews/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(sessionId)}/recap`;

export const recapApi = {
  read: (slug: string, sessionId: string) => request<Recap>(path(slug, sessionId)),
  share: (slug: string, sessionId: string, on: boolean) => post<{ url?: string }>(`${path(slug, sessionId)}/share`, { public: on }),
  shared: (token: string) => request<PublicRecap>(`/v1/recaps/${encodeURIComponent(token)}`),
};
