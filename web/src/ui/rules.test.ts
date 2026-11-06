import { describe, expect, it } from 'vitest';
import type { ChatEntry, RoomView } from '../room/session';
import { canControl, canQueue, chatScroll, countUnread, drivingLine, failureNote, noticesToShow, offersInvite } from './rules';

const view = (patch: Partial<RoomView>): RoomView =>
  ({
    offlineSince: null,
    self: { userId: 'a', name: 'Ada', role: 'member' },
    settings: { controlMode: 'everyone', queueMode: 'everyone' },
    playback: { item: 'x', status: 'playing', pos: 0, at: 0, rate: 1 },
    ...patch,
  }) as RoomView;

describe('drivingLine', () => {
  const room = (role: string, ...members: { name: string; role: string }[]) => view({ self: { userId: 'a', role }, members: members.map((person, index) => ({ userId: 'u' + index, ...person })) } as Partial<RoomView>);

  it('names whoever has the controls', () => {
    expect(drivingLine(room('member', { name: 'Maya Lin', role: 'host' }))).toBe('Maya’s driving');
    expect(drivingLine(room('host', { name: 'Maya', role: 'member' }))).toBe('You’re driving');
  });

  it('still reads if the host has gone', () => {
    expect(drivingLine(room('member', { name: 'Sam', role: 'member' }))).toBe('The host’s driving');
  });
});

describe('failureNote', () => {
  const people = (...ids: string[]) => ids.map((userId) => ({ userId, name: userId, role: 'member' as const }));
  const self = { userId: 'a', name: 'a', role: 'member' as const };

  it('never claims others are watching when nobody is', () => {
    const everyone = view({ self, members: people('a', 'b'), viewerStates: { a: 'unavailable', b: 'unavailable' } });
    expect(failureNote(everyone)).toBe('Skipping.');
  });

  it('says so when others can still watch', () => {
    expect(failureNote(view({ self, members: people('a', 'b'), viewerStates: { a: 'unavailable', b: 'synced' } }))).toBe('Others are still watching.');
  });

  it('counts this viewer before their own report comes back', () => {
    expect(failureNote(view({ self, members: people('a', 'b', 'c'), viewerStates: { b: 'unavailable' } }))).toBe('Skipping.');
  });

  it('has nothing to say to someone alone in a room that will move on', () => {
    expect(failureNote(view({ self, members: people('a'), viewerStates: {}, alone: true }))).toBe('Skipping.');
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

describe('noticesToShow', () => {
  const skipped = { id: 'a', kind: 'skipped', text: 'Skipped it.' };
  const host = { id: 'b', kind: 'host', text: 'Bea is the host now.' };
  const other = { id: 'c', text: 'Something else.' };
  const notices: { id: string; kind?: string; text: string }[] = [skipped, host, other];

  it('leaves out what the open chat already says, or it covers the same words', () => {
    expect(noticesToShow(notices, 'chat', false)).toEqual([other]);
  });

  it('keeps a notice whose link the chat line does not have', () => {
    const wayOut = { id: 'd', kind: 'skipped', text: 'Skipped it.', url: 'https://youtu.be/x' };
    expect(noticesToShow([wayOut], 'chat', false)).toEqual([wayOut]);
  });

  it('shows everything when the chat is not on screen', () => {
    expect(noticesToShow(notices, 'queue', false)).toEqual(notices);
    expect(noticesToShow(notices, 'chat', true)).toEqual(notices);
  });
});

describe('offersInvite', () => {
  const queue = [{ id: 'q' }] as RoomView['queue'];
  const line = { kind: 'chat' } as ChatEntry;

  it('stays open for someone alone with nothing said, with or without a video', () => {
    expect(offersInvite(view({ alone: true, queue, messages: [] }))).toBe(true);
    expect(offersInvite(view({ alone: true, queue: [], messages: [] }))).toBe(true);
  });

  it('waits to be asked once anyone else is here or anything was said', () => {
    expect(offersInvite(view({ alone: true, queue, messages: [line] }))).toBe(false);
    expect(offersInvite(view({ alone: false, queue, messages: [] }))).toBe(false);
  });
});
