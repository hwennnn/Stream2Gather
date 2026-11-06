import { describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { canControl, canQueue, pillFor } from './rules';

const view = (patch: Partial<RoomView>): RoomView =>
  ({
    offlineSince: null,
    self: { userId: 'a', name: 'Ada', role: 'member' },
    settings: { controlMode: 'everyone', queueMode: 'everyone' },
    playback: { item: 'x', status: 'playing', pos: 0, at: 0, rate: 1 },
    ...patch,
  }) as RoomView;

describe('pillFor', () => {
  it('puts being offline above everything', () => {
    expect(pillFor(view({ offlineSince: 1 }), 'synced', null).text).toBe('Offline');
  });

  it('names who paused, and says you when it was you', () => {
    const paused = view({ playback: { item: 'x', status: 'paused', pos: 0, at: 0, rate: 1 } });
    expect(pillFor(paused, 'synced', 'Maya').text).toBe('Paused by Maya');
    expect(pillFor(paused, 'synced', 'Ada').text).toBe('Paused by you');
    expect(pillFor(paused, 'synced', null).text).toBe('Paused');
  });

  it.each([
    ['synced', 'In sync'],
    ['correcting', 'Catching up'],
    ['buffering', 'Loading'],
    ['waiting', 'Loading'],
    ['stalled', 'Loading'],
  ] as const)('shows %s as %s', (health, text) => {
    expect(pillFor(view({}), health, null).text).toBe(text);
  });
});

describe('permissions', () => {
  const locked = { controlMode: 'hosts', queueMode: 'hosts' } as const;

  it('locks members out and leaves the host in', () => {
    expect(canControl(view({ settings: locked }))).toBe(false);
    expect(canQueue(view({ settings: locked }))).toBe(false);
    const host = view({ settings: locked, self: { userId: 'a', name: 'Ada', role: 'host' } });
    expect(canControl(host)).toBe(true);
    expect(canQueue(host)).toBe(true);
  });
});
