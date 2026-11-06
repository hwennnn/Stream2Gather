import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchAutoplay } from './autoplay';
import type { PlayerAdapter, PlayerState } from './types';

const CHECK_MS = 2500;

const fakePlayer = (state: PlayerState) => {
  let muted = false;
  let blocked = () => {};
  const player = {
    state: () => state,
    muted: () => muted,
    setMuted: vi.fn((next: boolean) => { muted = next; }),
    play: vi.fn(),
    onBlocked: (listener: () => void) => { blocked = listener; },
  };
  return {
    player: player as unknown as PlayerAdapter,
    setState: (next: PlayerState) => { state = next; },
    block: () => blocked(),
    ...player,
  };
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
    watchAutoplay(() => true, () => false, fake.player, onMuted);
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).toHaveBeenCalledWith(true);
    expect(fake.play).toHaveBeenCalled();
    expect(onMuted).toHaveBeenCalledWith(true);
  });

  it.each<PlayerState>(['loading', 'buffering'])('does not mute a slow load that is %s', (state) => {
    const fake = fakePlayer(state);
    watchAutoplay(() => true, () => false, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('asks the viewer only once starting muted has been refused too', () => {
    const fake = fakePlayer('ready');
    const onRefused = vi.fn();
    watchAutoplay(() => true, () => false, fake.player, vi.fn(), onRefused);
    vi.advanceTimersByTime(CHECK_MS);
    expect(onRefused).not.toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(CHECK_MS);
    expect(onRefused).toHaveBeenCalledWith(true);
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the viewer has pressed play, even in a paused room', () => {
    const fake = fakePlayer('ready');
    const onRefused = vi.fn();
    let playing = true;
    watchAutoplay(() => playing, () => false, fake.player, vi.fn(), onRefused);
    vi.advanceTimersByTime(CHECK_MS * 2);
    playing = false;
    vi.advanceTimersByTime(CHECK_MS);
    fake.setState('playing');
    vi.advanceTimersByTime(CHECK_MS);
    expect(onRefused).toHaveBeenLastCalledWith(false);
  });

  it('never asks while the room is paused, or after a stop someone meant', () => {
    const fake = fakePlayer('ready');
    const onRefused = vi.fn();
    watchAutoplay(() => false, () => false, fake.player, vi.fn(), onRefused);
    watchAutoplay(() => true, () => true, fake.player, vi.fn(), onRefused);
    vi.advanceTimersByTime(CHECK_MS * 3);
    expect(onRefused).not.toHaveBeenCalledWith(true);
  });

  it('leaves a slow load alone once it plays', () => {
    const fake = fakePlayer('loading');
    watchAutoplay(() => true, () => false, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    fake.setState('playing');
    vi.advanceTimersByTime(CHECK_MS * 3);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('takes a pause after the video has played for the viewer pausing', () => {
    const fake = fakePlayer('loading');
    watchAutoplay(() => true, () => false, fake.player, vi.fn());
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
    watchAutoplay(() => true, () => false, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    fake.setState('paused');
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).toHaveBeenCalledWith(true);
  });

  it('leaves a paused room alone', () => {
    const fake = fakePlayer('paused');
    watchAutoplay(() => false, () => false, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('does not take a stop somebody meant for a refusal', () => {
    const fake = fakePlayer('paused');
    watchAutoplay(() => true, () => true, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS * 3);
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('still catches a refusal once that stop is over', () => {
    const fake = fakePlayer('paused');
    let onPurpose = true;
    watchAutoplay(() => true, () => onPurpose, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    onPurpose = false;
    vi.advanceTimersByTime(CHECK_MS);
    expect(fake.setMuted).toHaveBeenCalledWith(true);
  });

  it('mutes the moment the browser refuses, even long after joining', () => {
    const fake = fakePlayer('buffering');
    const onMuted = vi.fn();
    watchAutoplay(() => true, () => false, fake.player, onMuted);
    vi.advanceTimersByTime(CHECK_MS * 10);
    fake.block();
    expect(fake.setMuted).toHaveBeenCalledWith(true);
    expect(fake.play).toHaveBeenCalled();
    expect(onMuted).toHaveBeenCalledWith(true);
  });

  it('does not loop if a muted start is refused too', () => {
    const fake = fakePlayer('buffering');
    watchAutoplay(() => true, () => false, fake.player, vi.fn());
    fake.block();
    fake.block();
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('ignores a refusal in a paused room', () => {
    const fake = fakePlayer('ready');
    watchAutoplay(() => false, () => false, fake.player, vi.fn());
    fake.block();
    expect(fake.setMuted).not.toHaveBeenCalled();
  });

  it('stops when the player goes', () => {
    const fake = fakePlayer('loading');
    const stop = watchAutoplay(() => true, () => false, fake.player, vi.fn());
    vi.advanceTimersByTime(CHECK_MS);
    stop();
    fake.setState('paused');
    vi.advanceTimersByTime(CHECK_MS * 3);
    fake.block();
    expect(fake.setMuted).not.toHaveBeenCalled();
  });
});
