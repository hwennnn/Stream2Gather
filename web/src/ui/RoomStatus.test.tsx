// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../room/session';
import type { SyncHealth } from '../sync/controller';
import { RoomStatus } from './RoomStatus';
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
