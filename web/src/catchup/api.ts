import { post, request, type Media } from '../api/http';

export type Moment = { id: number; posMs: number; kind: 'reaction' | 'chat'; origin: 'live' | 'catchup'; author: string; emoji?: string; body?: string };

export type CrewVideo = { source: string; sourceId: string; crewName: string; media: Media | null };

export type MissedVideo = { itemId: number; startedAt: string; moments: number; media: Media };

const path = (slug: string) => `/v1/crews/${encodeURIComponent(slug)}`;

/** A long film's worth, at 500 a page. Past this the page shows what it has. */
const MAX_PAGES = 40;

export const catchupApi = {
  item: (slug: string, itemId: string) => request<CrewVideo>(`${path(slug)}/items/${encodeURIComponent(itemId)}`),
  missed: (slug: string) => request<{ items: MissedVideo[] }>(`${path(slug)}/missed`),
  /** Every page, because the density strip needs the whole video. */
  moments: async (slug: string, source: string, sourceId: string): Promise<Moment[]> => {
    const all: Moment[] = [];
    let after = '';
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ source, id: sourceId });
      if (after) query.set('after', after);
      const { items, next } = await request<{ items: Moment[]; next?: string }>(`${path(slug)}/moments?${query}`);
      all.push(...items);
      if (!next) break;
      after = next;
    }
    return all;
  },
  add: (slug: string, moment: { source: string; id: string; posMs: number; emoji?: string; body?: string }) =>
    post<{ id: number }>(`${path(slug)}/moments`, moment),
};
