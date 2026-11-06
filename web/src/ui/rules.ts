import type { Media, Person } from '../api/http';
import type { ChatEntry, RoomView } from '../room/session';
import { firstName } from './people';

export const isHost = (view: RoomView): boolean => view.self?.role === 'host';

/** You first, then the host, then everyone else in the order they came. */
export const rosterFor = (view: RoomView): Person[] => {
  const rank = ({ userId, role }: Person) => (userId === view.self?.userId ? 0 : role === 'host' ? 1 : 2);
  return [...view.members].sort((a, b) => rank(a) - rank(b) || (a.since ?? 0) - (b.since ?? 0));
};

/** From the member list, because joining a crew happens while connected. */
export const onCrew = (view: RoomView): boolean => view.members.some((person) => person.userId === view.self?.userId && person.member);

export const canControl = (view: RoomView): boolean => view.settings.controlMode === 'everyone' || isHost(view);

export const canQueue = (view: RoomView): boolean => view.settings.queueMode === 'everyone' || isHost(view);

export const isLocked = (view: RoomView): boolean =>
  view.settings.controlMode === 'hosts' || view.settings.queueMode === 'hosts';

/** Who has the controls in a locked room. */
export const drivingLine = (view: RoomView): string => {
  if (isHost(view)) return 'You’re driving';
  const host = view.members.find(({ role }) => role === 'host');
  return host ? `${firstName(host.name)}’s driving` : 'The host’s driving';
};

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

/** Chat keeps its box and People its host switch along the bottom of the rail, clear of toasts. */
export const toastLift = (tab: string): string => (tab === 'queue' ? 'bottom-3' : 'bottom-[84px]');

/** Alone with nothing said, the invite stays open without being asked for. */
export const offersInvite = (view: RoomView): boolean => view.alone && !view.messages.some(({ kind }) => kind === 'chat');

/** These are chat lines too. Over an open chat a toast only covers the same words, unless it has a link the line doesn't. */
const CHAT_NOTICES = new Set(['host', 'skipped']);

export const noticesToShow = <T extends { kind?: string; url?: string }>(notices: T[], tab: string, railHidden: boolean): T[] =>
  tab === 'chat' && !railHidden ? notices.filter(({ kind, url }) => url || !CHAT_NOTICES.has(kind ?? '')) : notices;
