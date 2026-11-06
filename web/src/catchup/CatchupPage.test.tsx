// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAdapter, PlayerError, PlayerState } from '../players/types';
import { catchupApi, type CrewVideo, type Moment } from './api';
import CatchupPage from './CatchupPage';

const player = vi.hoisted(() => ({ time: 0, state: 'ready' as PlayerState, fail: null as null | ((error: PlayerError) => void), startAt: -1, autoplay: true }));
vi.mock('../players/registry', () => ({
  createPlayer: async (_: HTMLElement, __: unknown, startAt: number, autoplay: boolean) => {
    player.startAt = startAt;
    player.autoplay = autoplay;
    return {
      time: () => player.time,
      state: () => player.state,
      seek: (seconds: number) => {
        player.time = seconds;
      },
      onError: (listener: (error: PlayerError) => void) => {
        player.fail = listener;
      },
      destroy: () => {},
    } as unknown as PlayerAdapter;
  },
}));

const video: CrewVideo = {
  source: 'youtube',
  sourceId: 'a',
  crewName: 'Sundays',
  media: { source: 'youtube', sourceId: 'a', url: 'https://youtu.be/a', title: 'Heat', durationMs: 60_000 } as never,
};

const moment = (id: number, posMs: number): Moment => ({ id, posMs, kind: 'reaction', origin: 'live', author: 'Hana Sato', emoji: '🔥' });

const advance = async (seconds: number) => {
  player.time = seconds;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
};

const open = async (moments: Moment[]) => {
  vi.spyOn(catchupApi, 'item').mockResolvedValue(video);
  vi.spyOn(catchupApi, 'moments').mockResolvedValue(moments);
  render(<CatchupPage slug="sundays" itemId="9" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(player, { time: 0, state: 'playing', fail: null, startAt: -1, autoplay: true });
  window.history.replaceState(null, '', '/r/sundays/catchup/9');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CatchupPage', () => {
  it('names who reacted as the video reaches the moment, and not before', async () => {
    await open([moment(1, 724_000)]);
    await advance(723.5);
    await advance(723.75);
    expect(screen.queryByText(/Hana/)).toBeNull();

    await advance(724);

    const line = screen.getByRole('list', { name: 'Reactions' }).textContent;
    expect(line).toContain('Hana, 12:04, 🔥');
  });

  it('never starts the video itself, and starts where the link says', async () => {
    window.history.replaceState(null, '', '/r/sundays/catchup/9?at=714000');
    await open([]);

    expect(player.autoplay).toBe(false);
    expect(player.startAt).toBe(714);
  });

  it('shows what was skipped without firing it', async () => {
    await open([moment(1, 5000), moment(2, 6000)]);
    await advance(0);

    await advance(30);

    expect(screen.getByRole('list', { name: 'Reactions' }).children).toHaveLength(2);
    expect(document.querySelector('[data-fired]')).toBeNull();
  });

  it('keeps playing when reactions fail to load, and can try again', async () => {
    vi.spyOn(catchupApi, 'item').mockResolvedValue(video);
    const moments = vi.spyOn(catchupApi, 'moments').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([moment(1, 1000)]);
    render(<CatchupPage slug="sundays" itemId="9" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText(/Couldn’t load reactions/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(moments).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Couldn’t load reactions/)).toBeNull();
  });

  it('falls back to a text timeline when the video won’t embed', async () => {
    await open([moment(1, 724_000)]);

    act(() => player.fail?.({ kind: 'embed', code: 150 } as never));

    expect(screen.getByRole('link', { name: 'Open on YouTube' }).getAttribute('href')).toBe('https://youtu.be/a');
    expect(screen.getByRole('list', { name: 'Reactions' }).textContent).toContain('12:04');
  });

  it('says a video is unavailable, with the way back', async () => {
    vi.spyOn(catchupApi, 'item').mockResolvedValue({ ...video, media: null });

    render(<CatchupPage slug="sundays" itemId="9" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('Video unavailable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sundays' }).getAttribute('href')).toBe('/r/sundays');
  });

  it('never opens a socket', async () => {
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', socket);
    await open([moment(1, 1000)]);
    await advance(2);

    expect(socket).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
