// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../room/session';
import type { SyncHealth } from '../sync/controller';
import { RoomStatus, useLatestAct } from './RoomStatus';
import type { RoomPlayer } from './useRoomPlayer';

const me = { userId: 'me', name: 'Ada', role: 'member' };
const view = {
  self: me,
  members: [me, { userId: 'm', name: 'Maya', role: 'host' }],
  alone: false,
  viewerStates: {},
  queue: [{ id: 'a' }],
  playback: { item: 'a', status: 'playing', pos: 200, at: Date.now(), rate: 1 },
} as unknown as RoomView;

const player = (health: SyncHealth, started: boolean) => {
  const report = { health, drift: 1 };
  return { started, failure: null, refused: false, reports: { get: () => report, subscribe: () => () => {} } } as unknown as RoomPlayer;
};

const show = (shown: RoomPlayer, shownView = view) => render(<RoomStatus view={shownView} player={shown} act={null} offlineFor={null} onRetry={() => {}} />);

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const line = () => document.querySelector('[data-room-status]');

describe('RoomStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says nothing about loading for the first two seconds', async () => {
    show(player('waiting', false));
    await wait(1900);
    expect(screen.queryByText('Loading…')).toBeNull();
    await wait(200);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('never goes amber for a blip, and does for a gap that lasts', async () => {
    show(player('correcting', true));
    await wait(1900);
    expect(line()?.className).not.toContain('text-warn');
    await wait(200);
    expect(line()?.className).toContain('text-warn');
    expect(line()?.getAttribute('data-room-status')).toBe('behind');
  });

  it('clears by itself', async () => {
    const { rerender } = show(player('correcting', true));
    await wait(2100);
    rerender(<RoomStatus view={view} player={player('synced', true)} act={null} offlineFor={null} onRetry={() => {}} />);
    expect(line()?.getAttribute('data-room-status')).toBe('playing');
  });

  it('waits before blaming a friend for a blip', async () => {
    show(player('synced', true), { ...view, viewerStates: { m: 'buffering' } });
    await wait(1900);
    expect(screen.queryByText(/catching up/)).toBeNull();
    await wait(200);
    expect(line()?.textContent).toBe('Maya is catching up');
  });

  it('leaves the sentence out where there’s no room for it', () => {
    render(<RoomStatus view={view} player={player('synced', true)} act={null} offlineFor={null} onRetry={() => {}} compact />);
    expect(line()?.textContent).toMatch(/^Playing at \d+:\d\d$/);
  });
});

describe('useLatestAct', () => {
  const people = (...names: string[]) => names.map((name) => ({ userId: name, name, role: 'member' }));
  const room = (patch: object) => ({ ...view, lastAction: null, ...patch }) as unknown as RoomView;
  const mount = (first: RoomView) => renderHook(({ shown }) => useLatestAct(shown), { initialProps: { shown: first } });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('counts everyone who sat down while the news is fresh', () => {
    const { result, rerender } = mount(room({ members: people('Ada') }));
    rerender({ shown: room({ members: people('Ada', 'Sam Okafor') }) });
    expect(result.current).toEqual({ by: 'Sam Okafor', text: 'took a seat' });
    rerender({ shown: room({ members: people('Ada', 'Sam Okafor', 'Priya Nair') }) });
    expect(result.current).toEqual({ by: 'Sam Okafor', text: 'and Priya took seats' });
    rerender({ shown: room({ members: people('Ada', 'Sam Okafor', 'Priya Nair', 'Theo', 'Lena') }) });
    expect(result.current).toEqual({ by: 'Sam Okafor', text: 'and 3 others took seats' });
  });

  it('starts counting again once that news is old', () => {
    const { result, rerender } = mount(room({ members: people('Ada') }));
    rerender({ shown: room({ members: people('Ada', 'Sam') }) });
    act(() => void vi.advanceTimersByTime(4000));
    expect(result.current).toBeNull();
    rerender({ shown: room({ members: people('Ada', 'Sam', 'Noor') }) });
    expect(result.current).toEqual({ by: 'Noor', text: 'took a seat' });
  });

  const next = { id: 'b', addedBy: 'm', addedByName: 'Maya' };
  const playing = (item: string, patch = {}) => room({ queue: [item === 'b' ? next : { id: item }], playback: { item, status: 'playing' }, ...patch });

  it('says whose pick the next video is', () => {
    const { result, rerender } = mount(playing('a'));
    rerender({ shown: playing('b') });
    expect(result.current).toEqual({ by: 'Maya', text: 'picked this' });
  });

  it('doesn’t tell you it was your own', () => {
    const { result, rerender } = mount(playing('a'));
    rerender({ shown: room({ queue: [{ ...next, addedBy: 'me', addedByName: 'Ada' }], playback: { item: 'b', status: 'playing' } }) });
    expect(result.current).toBeNull();
  });

  it('leaves a skip to say who skipped', () => {
    const { result, rerender } = mount(playing('a'));
    rerender({ shown: playing('b', { lastAction: { by: 'Sam', cause: 'skip' } }) });
    expect(result.current).toEqual({ by: 'Sam', text: 'skipped', fig: undefined });
  });

  it('says nothing about what was already on when you came in', () => {
    expect(mount(playing('b')).result.current).toBeNull();
  });
});
