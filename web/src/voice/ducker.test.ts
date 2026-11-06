import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAdapter } from '../players/types';
import { Ducker } from './ducker';

const fakePlayer = (start = 0.8, muted = false) => {
  const player = { level: start, writes: [] as number[], muted: () => muted, volume: () => player.level, setVolume: (value: number) => {
    player.level = value;
    player.writes.push(value);
  } };
  return player;
};

const asAdapter = (player: ReturnType<typeof fakePlayer>) => player as unknown as PlayerAdapter;

const ducker = (player: ReturnType<typeof fakePlayer> | null, enabled = true) =>
  new Ducker({ player: () => (player ? asAdapter(player) : null), enabled: () => enabled });

describe('Ducker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('comes down to 30% of the viewer’s level in steps over about 150 ms', () => {
    const player = fakePlayer(0.8);
    ducker(player).speaking(true);
    vi.advanceTimersByTime(60);
    expect(player.level).toBeLessThan(0.8);
    expect(player.level).toBeGreaterThan(0.24);
    vi.advanceTimersByTime(90);
    expect(player.level).toBeCloseTo(0.24);
    expect(player.writes).toHaveLength(5);
  });

  it('holds for 600 ms after the last voice, then returns to the viewer’s level', () => {
    const player = fakePlayer(0.8);
    const duck = ducker(player);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    duck.speaking(false);
    vi.advanceTimersByTime(590);
    expect(player.level).toBeCloseTo(0.24);
    vi.advanceTimersByTime(10 + 150);
    expect(player.level).toBeCloseTo(0.8);
  });

  it('stays down when the next voice starts during the hold', () => {
    const player = fakePlayer(0.8);
    const duck = ducker(player);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    duck.speaking(false);
    vi.advanceTimersByTime(300);
    duck.speaking(true);
    vi.advanceTimersByTime(2000);
    expect(player.level).toBeCloseTo(0.24);
  });

  it('writes nothing when already down', () => {
    const player = fakePlayer(0.8);
    const duck = ducker(player);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    const writes = player.writes.length;
    duck.speaking(false);
    vi.advanceTimersByTime(100);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    expect(player.writes).toHaveLength(writes);
  });

  it('turns back down if a voice starts while the video is on its way up', () => {
    const player = fakePlayer(0.8);
    const duck = ducker(player);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    duck.speaking(false);
    vi.advanceTimersByTime(600 + 60);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    expect(player.level).toBeCloseTo(0.24);
    duck.speaking(false);
    vi.advanceTimersByTime(1000);
    expect(player.level).toBeCloseTo(0.8);
  });

  it('leaves the volume alone once the viewer has moved it', () => {
    const player = fakePlayer(0.8);
    const duck = ducker(player);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    player.level = 0.5;
    duck.speaking(false);
    vi.advanceTimersByTime(2000);
    expect(player.level).toBe(0.5);
  });

  it('stops mid-ramp when the viewer moves the volume', () => {
    const player = fakePlayer(0.8);
    ducker(player).speaking(true);
    vi.advanceTimersByTime(60);
    player.level = 0.1;
    const writes = player.writes.length;
    vi.advanceTimersByTime(1000);
    expect(player.writes).toHaveLength(writes);
  });

  it('takes a late report of the previous write as ours', () => {
    const player = fakePlayer(0.8);
    const duck = ducker(player);
    const reported = player.volume;
    let lagging = player.level;
    player.volume = () => {
      const value = lagging;
      lagging = player.level;
      return value;
    };
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    player.volume = reported;
    expect(player.level).toBeCloseTo(0.24);
  });

  it('leaves a muted player alone', () => {
    const player = fakePlayer(0.8, true);
    ducker(player).speaking(true);
    vi.advanceTimersByTime(1000);
    expect(player.writes).toEqual([]);
  });

  it('does nothing when off, or when the player can’t say its volume', () => {
    const off = fakePlayer(0.8);
    ducker(off, false).speaking(true);
    const unknown = fakePlayer(0.8);
    unknown.volume = () => null as unknown as number;
    ducker(unknown).speaking(true);
    ducker(null).speaking(true);
    vi.advanceTimersByTime(1000);
    expect(off.writes).toEqual([]);
    expect(unknown.writes).toEqual([]);
  });

  it('forgets the old video when the player changes', () => {
    const first = fakePlayer(0.8);
    const second = fakePlayer(1);
    let current = first;
    const duck = new Ducker({ player: () => asAdapter(current), enabled: () => true });
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    current = second;
    duck.speaking(false);
    vi.advanceTimersByTime(2000);
    expect(second.writes).toEqual([]);
  });

  it('puts the level back at once on stop', () => {
    const player = fakePlayer(0.8);
    const duck = ducker(player);
    duck.speaking(true);
    vi.advanceTimersByTime(200);
    duck.stop();
    expect(player.level).toBeCloseTo(0.8);
    vi.advanceTimersByTime(2000);
    expect(player.level).toBeCloseTo(0.8);
  });
});
