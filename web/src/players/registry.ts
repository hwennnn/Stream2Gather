import type { Media } from '../api/http';
import { createHtml5Player } from './html5';
import type { PlayerAdapter } from './types';
import { createYouTubePlayer } from './youtube';

type Playable = Pick<Media, 'source' | 'sourceId' | 'url'>;

type Factory = (element: HTMLElement, media: Playable, startAt: number, autoplay: boolean) => Promise<PlayerAdapter>;

/** A source that needs its own SDK loads it from here with import(), to keep it out of this chunk. */
const FACTORIES: Record<string, Factory> = {
  youtube: (element, media, startAt, autoplay) => createYouTubePlayer(element, media.sourceId, startAt, autoplay),
};

const direct: Factory = (element, media, startAt) => createHtml5Player(element, media.url, startAt);

export const createPlayer: Factory = (element, media, startAt, autoplay) =>
  (FACTORIES[media.source] ?? direct)(element, media, startAt, autoplay);
