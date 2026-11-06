import type { Media } from '../api/http';
import type { ChatEntry, RoomView } from '../room/session';
import type { SyncHealth } from '../sync/controller';

export const isHost = (view: RoomView): boolean => view.self?.role === 'host';

export const canControl = (view: RoomView): boolean => view.settings.controlMode === 'everyone' || isHost(view);

export const canQueue = (view: RoomView): boolean => view.settings.queueMode === 'everyone' || isHost(view);

export const isLocked = (view: RoomView): boolean =>
  view.settings.controlMode === 'hosts' || view.settings.queueMode === 'hosts';

export const isOffline = (view: RoomView): boolean => view.offlineSince !== null;

export const mediaKey = (media: Pick<Media, 'source' | 'sourceId'>): string => `${media.source}:${media.sourceId}`;

/** Chat from other people since the line last seen, not counting history. */
export const countUnread = (entries: ChatEntry[], seen: ChatEntry['id'] | null, selfId: string | undefined): number => {
  const from = entries.findIndex((entry) => entry.id === seen);
  return entries
    .slice(from + 1)
    .filter((entry) => entry.kind === 'chat' && !entry.history && entry.userId !== selfId).length;
};

/** What the chat list does on showing, or on the last line changing. */
export const chatScroll = (stuck: boolean, fresh: boolean, mine: boolean): 'bottom' | 'flag' | 'stay' => {
  if (stuck || (fresh && mine)) return 'bottom';
  return fresh ? 'flag' : 'stay';
};

/** Mirrors the server, which moves the room on once most viewers can't play the video. */
export const failureNote = (view: RoomView): string => {
  const selfId = view.self?.userId;
  const failing = view.members.filter(
    ({ userId }) => userId === selfId || view.viewerStates[userId] === 'unavailable',
  ).length;
  if (failing * 2 > view.members.length) return 'Skipping.';
  return view.alone ? '' : 'Others are still watching.';
};

export type Pill = { text: string; tone: 'good' | 'paused' | 'warn' | 'bad' };

/** What the sync pill says. Only the room's own words: no milliseconds, no jargon. */
export const pillFor = (view: RoomView, health: SyncHealth): Pill => {
  if (isOffline(view)) return { text: 'Offline', tone: 'bad' };
  const { status, pausedBy, pausedById } = view.playback;
  if (status === 'paused') {
    if (!pausedBy) return { text: 'Paused when everyone left', tone: 'paused' };
    return { text: `Paused by ${pausedById === view.self?.userId ? 'you' : pausedBy}`, tone: 'paused' };
  }
  if (health === 'synced') return { text: 'In sync', tone: 'good' };
  if (health === 'correcting') return { text: 'Catching up', tone: 'warn' };
  return { text: 'Loading', tone: 'warn' };
};
