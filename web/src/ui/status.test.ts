import { describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { actFor, statusFor, type Part } from './status';

const me = { userId: 'me', name: 'Ada', role: 'member' as const };
const maya = { userId: 'm', name: 'Maya', role: 'host' as const };

const view = (patch: Partial<RoomView> = {}): RoomView =>
  ({ self: me, members: [maya, me], alone: false, viewerStates: {}, playback: { status: 'playing' }, ...patch }) as unknown as RoomView;

const say = (parts: Part[]) =>
  parts.map((part) => (typeof part === 'string' ? part : 'who' in part ? part.who : part.fig)).join('');

const status = (patch: Partial<Parameters<typeof statusFor>[0]>) =>
  statusFor({ view: view(), health: 'synced', failed: false, act: null, position: 200, ...patch });

const line = (patch: Partial<Parameters<typeof statusFor>[0]>) => {
  const { parts, tail = '' } = status(patch);
  return say(parts) + tail;
};

const paused = (pausedBy?: string, pausedById?: string) => ({ status: 'paused', pausedBy, pausedById }) as RoomView['playback'];

describe('statusFor', () => {
  it('never leaves a pause anonymous when it knows who did it', () => {
    expect(line({ view: view({ playback: paused('Maya', 'm') }) })).toBe('Paused by Maya at 3:20');
  });

  it('tells a viewer the browser refused to press play themselves', () => {
    expect(line({ health: 'correcting', refused: true })).toBe('Press play on the video to join in');
  });

  it('never gives a live channel a position', () => {
    expect(line({ live: true })).toBe('Live: everyone’s on the same channel');
  });

  it('says you when it was you', () => {
    expect(line({ view: view({ playback: paused('Ada', 'me') }) })).toBe('Paused by you at 3:20');
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

  it('keeps the name of a friend at an ad', () => {
    expect(line({ view: view({ viewerStates: { m: 'stalled' } }) })).toBe('Maya is at an ad');
  });

  it('keeps the room’s time on show when the player failed for you', () => {
    expect(line({ failed: true })).toBe('The room is at 3:20');
  });

  it('says where a paused room is when the player failed, not who paused it', () => {
    expect(line({ failed: true, view: view({ playback: paused('Maya', 'm') }) })).toBe('The room is paused at 3:20');
  });

  it('drops the name of someone who paused and left', () => {
    expect(line({ view: view({ members: [me], alone: true, playback: paused('Maya', 'm') }) })).toBe('Paused at 3:20');
  });

  it('goes by id, so a stranger with the same name doesn’t get the credit', () => {
    expect(line({ view: view({ members: [me, { ...maya, userId: 'other' }], playback: paused('Maya', 'm') }) })).toBe('Paused at 3:20');
  });

  it('shows the name someone has now', () => {
    expect(line({ view: view({ members: [me, { ...maya, name: 'Maya K' }], playback: paused('Maya', 'm') }) })).toBe('Paused by Maya K at 3:20');
  });

  it('never says Loading in a paused room', () => {
    expect(line({ health: 'buffering', view: view({ playback: paused('Maya', 'm') }) })).toBe('Paused by Maya at 3:20');
  });

  it('calls an ad an ad', () => {
    expect(line({ health: 'stalled' })).toBe('You’re at an ad. You’ll catch up after it.');
  });

  it('claims everyone is together only when every seat is', () => {
    expect(line({ view: view({ viewerStates: { m: 'unavailable' } }) })).toBe('Playing at 3:20');
  });

  describe('offline', () => {
    const offline = (patch: Partial<Parameters<typeof statusFor>[0]>) => line({ offlineFor: 2000, view: view({ queue: [{}] as RoomView['queue'] }), ...patch });

    it('says the video carries on only when it does', () => {
      expect(offline({})).toBe('Reconnecting. The video keeps playing.');
      expect(offline({ view: view({ queue: [{}] as RoomView['queue'], playback: paused('Maya', 'm') }) })).toBe('Reconnecting. Your video stays paused.');
    });

    it('promises nothing when there’s no video to carry on', () => {
      expect(line({ offlineFor: 2000, view: view({ queue: [] }) })).toBe('Reconnecting.');
      expect(offline({ failed: true })).toBe('Reconnecting.');
    });

    it('offers a retry once waiting has stopped helping', () => {
      expect(status({ offlineFor: 31_000, view: view({ queue: [] }) }).retry).toBe(true);
    });

    it('outranks whatever anyone last did', () => {
      expect(offline({ act: { by: 'Maya', text: 'skipped' } })).toMatch(/^Reconnecting/);
    });
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
