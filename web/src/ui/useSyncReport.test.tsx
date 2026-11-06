// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAdapter } from '../players/types';
import type { RoomSession, RoomView } from '../room/session';
import { RoomStatus } from './RoomStatus';
import { useRoomPlayer } from './useRoomPlayer';

const adapter = {
  rates: 'fine',
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  setRate: vi.fn(),
  time: () => Date.now() / 1000,
  state: () => 'playing',
  setMuted: vi.fn(),
  muted: () => false,
  onState: vi.fn(),
  onError: vi.fn(),
  onBlocked: vi.fn(),
  duration: () => 0,
  destroy: vi.fn(),
} as unknown as PlayerAdapter;

vi.mock('../players/registry', () => ({ createPlayer: async () => adapter }));

const playback = { item: 'a', status: 'playing', pos: 0, at: 0, rate: 1 };
const view = { queue: [{ id: 'a', source: 'direct' }], playback, viewerStates: {}, members: [], offlineSince: null } as unknown as RoomView;
const session = {
  getView: () => view,
  clock: { now: () => Date.now() },
  send: () => true,
  onPlayback: () => {},
  reportStatus: () => {},
} as unknown as RoomSession;

/** One second at a time, or act would batch them into a single redraw. */
const seconds = async (count: number) => {
  for (let n = 0; n < count; n += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
};

const mounted = async () => {
  let renders = 0;
  const { result } = renderHook(() => {
    renders += 1;
    const player = useRoomPlayer(session, view);
    if (!player.stage.current) player.stage.current = document.createElement('div');
    return player;
  });
  await seconds(4);
  return { result, renders: () => renders };
};

describe('the room player', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 10_000 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the sync report from redrawing the room every second', async () => {
    const { renders } = await mounted();
    const settled = renders();
    await seconds(5);
    expect(renders()).toBe(settled);
  });

  it('still tells the status how the sync is going', async () => {
    const { result } = await mounted();
    render(<RoomStatus view={view} player={{ ...result.current, started: true }} act={null} offlineFor={null} onRetry={() => {}} />);
    await seconds(2);
    expect(screen.getByText(/everyone together/)).toBeTruthy();
  });
});
