import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchAutoplay } from './autoplay';
import type { PlayerAdapter, PlayerState } from './types';

const CHECK_MS = 2500;

const fakePlayer = (state: PlayerState) => {
  const player = { state: () => state, setMuted: vi.fn(), play: vi.fn() };
  return { player: player as unknown as PlayerAdapter, setState: (next: PlayerState) => { state = next; }, ...player };
};

describe('watchAutoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each<PlayerState>(['paused', 'ready'])('mutes a player left %s', (state) => {
    const fake = fakePlayer(state);
    const onMuted = vi.fn();
    watchAutoplay(() => true, fake.player, onMuted);
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).toHaveBeenCalledWith(true);
    expect(fake.play).toHaveBeenCalled();
    expect(onMuted).toHaveBeenCalledWith(true);
  });

  it.each<PlayerState>(['loading', 'buffering'])('does not mute a slow load that is %s', (state) => {
    const fake = fakePlayer(state);
    watchAutoplay(() => true, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('leaves a slow load alone once it plays', () => {
    const fake = fakePlayer('loading');
    watchAutoplay(() => true, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    fake.setState('playing');
    vi.advanceTimersByTime(CHECK_MS * 3);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('takes a pause after the video has played for the viewer pausing', () => {
    const fake = fakePlayer('loading');
    watchAutoplay(() => true, fake.player, vi.fn());
    fake.setState('playing');
    vi.advanceTimersByTime(CHECK_MS - 300);
    // The room still says playing, because a viewer's pause is held before it is sent.
    fake.setState('paused');
    vi.advanceTimersByTime(CHECK_MS * 3);
    expect(fake.setMuted).not.toHaveBeenCalled();
    expect(fake.play).not.toHaveBeenCalled();
  });

  it('still catches a slow load that was then refused', () => {
    const fake = fakePlayer('loading');
    watchAutoplay(() => true, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    fake.setState('paused');
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).toHaveBeenCalledWith(true);
  });

  it('leaves a paused room alone', () => {
    const fake = fakePlayer('paused');
    watchAutoplay(() => false, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('stops when the player goes', () => {
    const fake = fakePlayer('loading');
    const stop = watchAutoplay(() => true, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    stop();
    fake.setState('paused');
    vi.advanceTimersByTime(CHECK_MS * 3);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });
});
