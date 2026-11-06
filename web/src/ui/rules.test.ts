import { describe, expect, it } from 'vitest';
import type { ChatEntry, RoomView } from '../room/session';
import { canControl, canQueue, chatScroll, countUnread, pillFor } from './rules';

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

describe('countUnread', () => {
  const chat = (id: number, userId = 'other', history?: true): ChatEntry => ({
    kind: 'chat', id, userId, author: 'Maya', body: 'hi', createdAt: '', ...(history ? { history } : {}),
  });
  const line: ChatEntry = { kind: 'system', id: 's1', text: 'Maya joined', createdAt: '' };

  it('climbs with each message in a room with no history', () => {
    const shown = [chat(1), chat(2), chat(3)];
    expect([1, 2, 3].map((length) => countUnread(shown.slice(0, length), null, 'me'))).toEqual([1, 2, 3]);
  });

  it('does not count history', () => {
    expect(countUnread([chat(1, 'other', true), chat(2, 'other', true), chat(3)], null, 'me')).toBe(1);
  });

  it('counts from the line last seen', () => {
    expect(countUnread([chat(1), chat(2), chat(3)], 1, 'me')).toBe(2);
    expect(countUnread([chat(1), chat(2), chat(3)], 3, 'me')).toBe(0);
  });

  it('leaves out system lines and this viewer', () => {
    expect(countUnread([line, chat(1, 'me'), chat(2)], null, 'me')).toBe(1);
  });
});

describe('chatScroll', () => {
  it('follows along at the bottom', () => {
    expect(chatScroll(true, true, false)).toBe('bottom');
    expect(chatScroll(true, false, false)).toBe('bottom');
  });

  it('flags a new line for someone reading further up', () => {
    expect(chatScroll(false, true, false)).toBe('flag');
  });

  it('jumps down for their own message', () => {
    expect(chatScroll(false, true, true)).toBe('bottom');
  });

  it('says nothing when nothing is new', () => {
    expect(chatScroll(false, false, false)).toBe('stay');
    expect(chatScroll(false, false, true)).toBe('stay');
  });
});
