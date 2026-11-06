// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAdapter, PlayerState } from '../players/types';
import { watchReady } from './useRoomPlayer';

const setup = (first: PlayerState) => {
  let state = first;
  const onReady = vi.fn();
  const stop = watchReady({ state: () => state } as PlayerAdapter, onReady);
  return { onReady, stop, become: (next: PlayerState) => (state = next) };
};

describe('the poster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays while the player has nothing to show', () => {
    const { onReady } = setup('loading');
    vi.advanceTimersByTime(3000);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('stays through the first buffering, however slow', () => {
    const { onReady, become } = setup('loading');
    become('buffering');
    vi.advanceTimersByTime(15_000);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('is gone within a frame of the video playing', () => {
    const { onReady, become } = setup('buffering');
    become('playing');
    vi.advanceTimersByTime(17);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('gives way to a cued video, which shows YouTube’s own picture and play button', () => {
    const { onReady, become } = setup('loading');
    become('ready');
    vi.advanceTimersByTime(17);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('never covers a player that is already showing something', () => {
    expect(setup('paused').onReady).toHaveBeenCalledOnce();
    expect(setup('playing').onReady).toHaveBeenCalledOnce();
  });

  it('gets out of the way of a player that never starts, in case it needs a click', () => {
    const { onReady } = setup('loading');
    vi.advanceTimersByTime(8100);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('stops watching when the player goes', () => {
    const { onReady, stop, become } = setup('loading');
    stop();
    become('playing');
    vi.advanceTimersByTime(100);
    expect(onReady).not.toHaveBeenCalled();
  });
});
