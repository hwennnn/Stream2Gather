// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAdapter, PlayerError } from '../players/types';
import { createYouTubePlayer } from '../players/youtube';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { useRoomPlayer, watchFirstFrame } from './useRoomPlayer';

vi.mock('../players/youtube', () => ({ createYouTubePlayer: vi.fn() }));
vi.mock('../room/telemetry', () => ({ track: vi.fn() }));

const item = { id: 'item1', source: 'youtube', sourceId: 'abc', url: 'u' } as QueueItem;
const view = {
  queue: [item],
  playback: { item: 'item1', status: 'playing', pos: 0, at: 0, rate: 1 },
} as unknown as RoomView;

const session = {
  getView: () => view,
  send: vi.fn(),
  reportStatus: vi.fn(),
  onPlayback: vi.fn(),
  clock: { now: () => 0 },
} as unknown as RoomSession;

const fakePlayer = (error?: PlayerError) =>
  ({
    rates: 'discrete',
    state: () => 'loading',
    time: () => 0,
    muted: () => false,
    setMuted: () => {},
    play: () => {},
    pause: () => {},
    seek: () => {},
    setRate: () => {},
    onState: () => {},
    onBlocked: () => {},
    onError: (listener: (error: PlayerError) => void) => {
      if (error) listener(error);
    },
    destroy: vi.fn(),
  }) as unknown as PlayerAdapter;

let retry = () => {};

const Stage = () => {
  const player = useRoomPlayer(session, view);
  retry = player.retry;
  return (
    <>
      <div ref={player.stage} />
      <p>{player.failure ? `failed ${player.failure.code}` : 'no failure'}</p>
    </>
  );
};

describe('Try again', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads the player again in place, without leaving the room', async () => {
    const create = vi.mocked(createYouTubePlayer);
    create.mockResolvedValueOnce(fakePlayer({ kind: 'embed_blocked', code: 150 }));
    create.mockResolvedValueOnce(fakePlayer());

    render(<Stage />);
    await screen.findByText('failed 150');
    expect(create).toHaveBeenCalledTimes(1);

    act(() => retry());
    await screen.findByText('no failure');
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });

  it('shows the failure again if it is refused again', async () => {
    const create = vi.mocked(createYouTubePlayer);
    create.mockResolvedValue(fakePlayer({ kind: 'embed_blocked', code: 150 }));

    render(<Stage />);
    await screen.findByText('failed 150');
    act(() => retry());
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await screen.findByText('failed 150');
  });
});

describe('the first frame', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is told once, so a refusal elsewhere can be forgiven', () => {
    let state = 'loading';
    let time = 0;
    const player = { state: () => state, time: () => time } as unknown as PlayerAdapter;
    const played = vi.fn();
    const stop = watchFirstFrame(player, item, played);

    vi.advanceTimersByTime(1000);
    expect(played).not.toHaveBeenCalled();

    state = 'playing';
    time = 1;
    vi.advanceTimersByTime(1000);
    expect(played).toHaveBeenCalledTimes(1);
    stop();
  });
});
