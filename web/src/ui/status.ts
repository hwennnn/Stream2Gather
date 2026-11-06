import type { SyncHealth } from '../sync/controller';
import type { RoomView } from '../room/session';
import { formatTime } from './format';

/** Words, a person, or a figure. Colour and type come from which it is. */
export type Part = string | { who: string; userId?: string } | { fig: string };
export type Status = { parts: Part[]; tone: 'plain' | 'warn' };

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
};

const person = (view: RoomView, name: string, start: boolean): Part => {
  if (name === view.self?.name) return { who: start ? 'You' : 'you', userId: view.self.userId };
  return { who: name, userId: view.members.find((member) => member.name === name)?.userId };
};

const WAITING = new Set(['buffering', 'correcting', 'stalled']);

/** The one line that says what the room is doing. Names a person whenever one did it. */
export const statusFor = ({ view, health, failed, act, position }: Input): Status => {
  const time = { fig: formatTime(position) };
  if (act) return { parts: [person(view, act.by, true), ` ${act.text}`, ...(act.fig ? [' ', { fig: act.fig }] : [])], tone: 'plain' };
  if (view.playback.status === 'paused') {
    const { pausedBy } = view.playback;
    if (!pausedBy) return { parts: ['Paused when everyone left'], tone: 'plain' };
    return { parts: ['Paused by ', person(view, pausedBy, false), ' at ', time], tone: 'plain' };
  }
  if (failed) return { parts: ['The room is at ', time], tone: 'plain' };
  const behind = view.members.find(({ userId }) => userId !== view.self?.userId && WAITING.has(view.viewerStates[userId] ?? ''));
  if (health === 'correcting') return { parts: ['You’re catching up'], tone: 'warn' };
  if (behind) return { parts: [person(view, behind.name, true), ' is catching up'], tone: 'plain' };
  if (health !== 'synced') return { parts: ['Loading…'], tone: 'plain' };
  return { parts: ['Playing at ', time, view.alone ? '' : ', everyone together'], tone: 'plain' };
};
