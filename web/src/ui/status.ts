import type { SyncHealth } from '../sync/controller';
import type { RoomView } from '../room/session';
import { formatTime } from './format';

/** Words, a person, or a figure. Colour and type come from which it is. */
export type Part = string | { who: string; userId?: string } | { fig: string };

/** What the room is doing for this viewer. Every surface that shows the room's state reads this. */
export type RoomState = 'offline' | 'act' | 'failed' | 'paused' | 'refused' | 'loading' | 'ad' | 'behind' | 'friend' | 'playing';

export type Status = {
  state: RoomState;
  parts: Part[];
  /** The rest of the sentence, for where there's room for it. */
  tail?: string;
  tone: 'plain' | 'warn';
  /** Waiting has stopped helping, so the viewer gets a button. */
  retry?: boolean;
};

export type Act = { by: string; text: string; fig?: string };

const ACTS = new Map([
  ['play', 'pressed play'],
  ['skip', 'skipped'],
  ['seek', 'moved to'],
]);

/** What the room's last action says, if it's worth saying. */
export const actFor = (lastAction: RoomView['lastAction'], position: number): Act | null => {
  const text = lastAction && ACTS.get(lastAction.cause);
  if (!lastAction || !text) return null;
  return { by: lastAction.by, text, fig: lastAction.cause === 'seek' ? formatTime(position) : undefined };
};

type Input = {
  view: RoomView;
  health: SyncHealth;
  failed: boolean;
  act: Act | null;
  position: number;
  /** This viewer's player has shown a frame of this video. */
  started: boolean;
  /** Nothing to show yet, for long enough to be worth saying. */
  slow?: boolean;
  /** This viewer has been off the room's time for long enough to be real. */
  gap?: boolean;
  /** A friend has been behind for long enough to be real. */
  friendGap?: boolean;
  /** How long the connection has been gone, or null while it's fine. */
  offlineFor?: number | null;
  /** The browser won't start this player, so only the viewer can. */
  refused?: boolean;
  /** A live channel has no position to share. */
  live?: boolean;
};

const STILL_TRYING_MS = 30_000;

const person = (view: RoomView, name: string, start: boolean): Part => {
  if (name === view.self?.name) return { who: start ? 'You' : 'you', userId: view.self.userId };
  return { who: name, userId: view.members.find((member) => member.name === name)?.userId };
};

const WAITING = new Set(['buffering', 'correcting', 'stalled']);

/** What to say about someone. Nobody is behind a room that isn't moving, so a pause leaves only not being able to play. */
export const viewerState = (view: RoomView, userId: string): string | undefined => {
  const state = view.viewerStates[userId];
  return view.playback.status === 'paused' && state !== 'unavailable' ? undefined : state;
};

/** The first friend who is behind the room. */
export const laggingFriend = (view: RoomView) =>
  view.members.find(({ userId }) => userId !== view.self?.userId && WAITING.has(viewerState(view, userId) ?? ''));

/** "Everyone together" is a claim about every seat, so one that can't play breaks it too. */
const together = (view: RoomView): boolean =>
  !view.alone && !laggingFriend(view) && !view.members.some(({ userId }) => userId !== view.self?.userId && view.viewerStates[userId] === 'unavailable');

const offlineLine = (view: RoomView, failed: boolean, offlineFor: number): Status => {
  if (offlineFor >= STILL_TRYING_MS) return { state: 'offline', parts: ['Still trying. Check your connection.'], tone: 'warn', retry: true };
  const hasPicture = view.queue[0] !== undefined && !failed;
  const tail = !hasPicture ? undefined : view.playback.status === 'paused' ? ' Your video stays paused.' : ' The video keeps playing.';
  return { state: 'offline', parts: ['Reconnecting.'], tail, tone: 'warn' };
};

/** Whoever paused may have gone since, and then the name only asks where they went. */
const pausedLine = (view: RoomView, time: Part): Status => {
  const { pausedBy, pausedById } = view.playback;
  if (!pausedBy) return { state: 'paused', parts: ['Paused when everyone left'], tone: 'plain' };
  const here = view.members.find(({ userId, name }) => (pausedById ? userId === pausedById : name === pausedBy));
  if (!here) return { state: 'paused', parts: ['Paused at ', time], tone: 'plain' };
  return { state: 'paused', parts: ['Paused by ', person(view, here.name, false), ' at ', time], tone: 'plain' };
};

/** The one description of what the room is doing. Names a person whenever one did it. */
export const statusFor = ({ view, health, failed, act, position, started, slow, gap, friendGap, offlineFor = null, refused, live }: Input): Status => {
  const time = { fig: formatTime(position) };
  const paused = view.playback.status === 'paused';
  if (offlineFor !== null) return offlineLine(view, failed, offlineFor);
  if (act) return { state: 'act', parts: [person(view, act.by, true), ` ${act.text}`, ...(act.fig ? [' ', { fig: act.fig }] : [])], tone: 'plain' };
  // Who paused is for people watching. This viewer needs to know where the room is.
  if (failed) return { state: 'failed', parts: [paused ? 'The room is paused at ' : 'The room is at ', time], tone: 'plain' };
  if (paused) return pausedLine(view, time);
  if (refused) return { state: 'refused', parts: ['Press play on the video to join in'], tone: 'warn' };
  if (!started && slow) return { state: 'loading', parts: ['Loading…'], tone: 'plain' };
  if (started && health === 'stalled') return { state: 'ad', parts: ['You’re at an ad'], tail: '. You’ll catch up after it.', tone: 'plain' };
  if (started && gap) return { state: 'behind', parts: ['You’re catching up'], tone: 'warn' };
  const friend = laggingFriend(view);
  if (friend && friendGap) {
    const doing = view.viewerStates[friend.userId] === 'stalled' ? ' is at an ad' : ' is catching up';
    return { state: 'friend', parts: [person(view, friend.name, true), doing], tone: 'plain' };
  }
  // Below here nothing is wrong enough to mention, but only a viewer on the room's time is with it.
  const withThem = started && health === 'synced' && together(view);
  if (live) return { state: 'playing', parts: ['Live'], tail: withThem ? ': everyone’s on the same channel' : undefined, tone: 'plain' };
  return { state: 'playing', parts: ['Playing at ', time], tail: withThem ? ', everyone together' : undefined, tone: 'plain' };
};
