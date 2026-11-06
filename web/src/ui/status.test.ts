import { describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { actFor, statusFor, type Part } from './status';

const me = { userId: 'me', name: 'Ada', role: 'member' as const };
const maya = { userId: 'm', name: 'Maya', role: 'host' as const };

const view = (patch: Partial<RoomView> = {}): RoomView =>
  ({ self: me, members: [maya, me], alone: false, viewerStates: {}, playback: { status: 'playing' }, ...patch }) as unknown as RoomView;

const say = (parts: Part[]) =>
  parts.map((part) => (typeof part === 'string' ? part : 'who' in part ? part.who : part.fig)).join('');

const line = (patch: Partial<Parameters<typeof statusFor>[0]>) =>
  say(statusFor({ view: view(), health: 'synced', failed: false, act: null, position: 200, ...patch }).parts);

describe('statusFor', () => {
  it('never leaves a pause anonymous when it knows who did it', () => {
    expect(line({ view: view({ playback: { status: 'paused', pausedBy: 'Maya' } as RoomView['playback'] }) })).toBe('Paused by Maya at 3:20');
  });

  it('says you when it was you', () => {
    expect(line({ view: view({ playback: { status: 'paused', pausedBy: 'Ada' } as RoomView['playback'] }) })).toBe('Paused by you at 3:20');
  });

  it('says so when nobody paused it', () => {
    expect(line({ view: view({ playback: { status: 'paused' } as RoomView['playback'] }) })).toBe('Paused when everyone left');
  });

  it('puts the latest act ahead of the steady state', () => {
    expect(line({ act: { by: 'Maya', text: 'took a seat' } })).toBe('Maya took a seat');
  });

  it('names whoever is behind', () => {
    expect(line({ view: view({ viewerStates: { m: 'buffering' } }) })).toBe('Maya is catching up');
  });

  it('keeps the room’s time on show when the player failed for you', () => {
    expect(line({ failed: true })).toBe('The room is at 3:20');
  });

  it('says everyone is together, unless you’re alone', () => {
    expect(line({})).toBe('Playing at 3:20, everyone together');
    expect(line({ view: view({ alone: true }) })).toBe('Playing at 3:20');
  });
});

describe('actFor', () => {
  it('words a seek with where it landed', () => {
    expect(actFor({ by: 'Sam', cause: 'seek' }, 520)).toEqual({ by: 'Sam', text: 'moved to', fig: '8:40' });
  });

  it('ignores what the seat doesn’t need to say', () => {
    expect(actFor({ by: 'Sam', cause: 'queue.add' }, 0)).toBeNull();
    expect(actFor(null, 0)).toBeNull();
  });
});
