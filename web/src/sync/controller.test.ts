import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerAdapter, PlayerError, PlayerRates, PlayerState } from '../players/types';
import { ServerClock } from './clock';
import { DRIFT_OK_S, expectedPosition, SyncController, type LocalCommand, type Playback, type SyncReport } from './controller';

/** A player whose clock only moves when the test says so. */
class FakePlayer implements PlayerAdapter {
  rates: PlayerRates = { kind: 'discrete', values: [0.5, 1, 1.25, 1.5, 2] };
  current = 0;
  rate = 1;
  status: PlayerState = 'paused';
  seeks: number[] = [];
  private listener: (state: PlayerState) => void = () => {};

  play() { this.status = 'playing'; }
  pause() { this.status = 'paused'; }
  seek(seconds: number) { this.current = seconds; this.seeks.push(seconds); }
  setRate(rate: number) { this.rate = rate; }
  time() { return this.current; }
  state() { return this.status; }
  setMuted() {}
  muted() { return false; }
  onState(listener: (state: PlayerState) => void) { this.listener = listener; }
  onError(_listener: (error: PlayerError) => void) {}
  destroy() {}

  fire(state: PlayerState) { this.status = state; this.listener(state); }
  advance(seconds: number) { if (this.status === 'playing') this.current += seconds * this.rate; }
}

class FakeTimers {
  now = 100_000;
  private id = 0;
  private pending = new Map<number, { at: number; work: () => void }>();

  setTimeout = (work: () => void, ms: number) => {
    this.id += 1;
    this.pending.set(this.id, { at: this.now + ms, work });
    return this.id;
  };
  clearTimeout = (id: number) => { this.pending.delete(id); };

  advance(ms: number) {
    this.now += ms;
    for (const [id, timer] of [...this.pending]) {
      if (timer.at <= this.now) {
        this.pending.delete(id);
        timer.work();
      }
    }
  }
}

describe('ServerClock', () => {
  it('trusts the sample with the lowest round trip', () => {
    const clock = new ServerClock(() => 1000);
    clock.addSample(0, 5100, 200); // rtt 200, offset 5000
    clock.addSample(300, 5340, 320); // rtt 20, offset 5030
    clock.addSample(400, 6000, 900); // rtt 500, offset 5350
    expect(clock.offset).toBe(5030);
    expect(clock.now()).toBe(6030);
  });

  it('forgets old samples', () => {
    const clock = new ServerClock(() => 0);
    clock.addSample(0, 1000, 2);
    for (let i = 0; i < 8; i += 1) clock.addSample(0, 2000, 100);
    expect(clock.rtt).toBe(100);
  });
});

describe('expectedPosition', () => {
  const base: Playback = { item: 'a', status: 'playing', pos: 10, at: 1000, rate: 2 };

  it('holds before the start time', () => {
    expect(expectedPosition(base, 500)).toBe(10);
  });
  it('advances at the room rate', () => {
    expect(expectedPosition(base, 2000)).toBe(12);
  });
  it('does not move while paused', () => {
    expect(expectedPosition({ ...base, status: 'paused' }, 9000)).toBe(10);
  });
});

describe('SyncController', () => {
  let player: FakePlayer;
  let timers: FakeTimers;
  let commands: LocalCommand[];
  let reports: SyncReport[];
  let sync: SyncController;

  const playing = (pos: number, at: number, item = 'a'): Playback => ({ item, status: 'playing', pos, at, rate: 1 });

  /** Moves real time, the player and the once-a-second tick together. */
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 10; i += 1) {
      timers.advance(100);
      player.advance(0.1);
      if (i % 10 === 9) sync.tick();
    }
  };

  const drift = (playback: Playback) => player.time() - expectedPosition(playback, timers.now);

  beforeEach(() => {
    player = new FakePlayer();
    timers = new FakeTimers();
    commands = [];
    reports = [];
    sync = new SyncController(
      player,
      { now: () => timers.now },
      (command) => commands.push(command),
      (report) => reports.push(report),
      timers,
    );
  });

  it('holds until a shared start time, then plays', () => {
    sync.apply(playing(0, timers.now + 1500));
    expect(player.status).toBe('paused');
    timers.advance(1500);
    expect(player.status).toBe('playing');
  });

  it('does not touch a player within tolerance', () => {
    const playback = playing(0, timers.now);
    sync.apply(playback);
    run(2);
    player.seeks = [];
    player.current += DRIFT_OK_S / 2;
    run(3);
    expect(player.seeks).toEqual([]);
    expect(player.rate).toBe(1);
    expect(reports.at(-1)?.health).toBe('synced');
  });

  it('catches up with a rate nudge when slightly behind', () => {
    const playback = playing(0, timers.now);
    sync.apply(playback);
    run(2);
    player.seeks = [];
    player.current -= 0.8;
    run(8);
    expect(player.seeks).toEqual([]);
    expect(Math.abs(drift(playback))).toBeLessThan(DRIFT_OK_S);
    expect(player.rate).toBe(1);
  });

  it('pauses briefly when slightly ahead on a discrete-rate player', () => {
    const playback = playing(0, timers.now);
    sync.apply(playback);
    run(2);
    player.seeks = [];
    player.current += 0.8;
    run(6);
    expect(player.seeks).toEqual([]);
    expect(Math.abs(drift(playback))).toBeLessThan(DRIFT_OK_S);
    expect(player.status).toBe('playing');
  });

  it('uses a gentle rate on players with fine rate control', () => {
    player.rates = { kind: 'fine', min: 0.5, max: 2 };
    const playback = playing(0, timers.now);
    sync.apply(playback);
    run(2);
    player.current -= 0.5;
    run(1);
    expect(player.rate).toBeCloseTo(1.05);
    run(12);
    expect(Math.abs(drift(playback))).toBeLessThan(DRIFT_OK_S);
  });

  it('seeks when too far behind for a nudge', () => {
    const playback = playing(100, timers.now);
    player.current = 100;
    sync.apply({ ...playback });
    run(2);
    player.seeks = [];
    player.status = 'buffering';
    run(8); // Stuck for 8s, so nothing advances and the gap grows.
    player.status = 'playing';
    run(3);
    expect(player.seeks.length).toBe(1);
    expect(Math.abs(drift(playback))).toBeLessThan(0.5);
  });

  it('limits corrective seeks', () => {
    const playback = playing(0, timers.now);
    sync.apply(playback);
    run(2);
    player.seeks = [];
    for (let i = 0; i < 4; i += 1) {
      player.current = 0; // A player that keeps falling back.
      run(2);
    }
    expect(player.seeks.length).toBeLessThanOrEqual(1);
  });

  it('never corrects while buffering', () => {
    sync.apply(playing(0, timers.now));
    run(2);
    player.seeks = [];
    player.status = 'buffering';
    run(5);
    expect(player.seeks).toEqual([]);
    expect(reports.at(-1)?.health).toBe('buffering');
  });

  it('reports a stall, such as an ad, and leaves it alone', () => {
    sync.apply(playing(0, timers.now));
    run(2);
    player.seeks = [];
    const frozen = player.current;
    for (let i = 0; i < 5; i += 1) {
      timers.advance(1000);
      player.current = frozen;
      sync.tick();
    }
    expect(player.seeks).toEqual([]);
    expect(reports.at(-1)?.health).toBe('stalled');
  });

  it('turns the viewer pausing into a room command', () => {
    sync.apply(playing(0, timers.now));
    run(3);
    player.fire('paused');
    expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
  });

  it('does not echo its own pause back to the room', () => {
    sync.apply(playing(0, timers.now));
    run(3);
    sync.apply({ item: 'a', status: 'paused', pos: 3, at: timers.now, rate: 1 });
    player.fire('paused');
    expect(commands).toEqual([]);
  });

  it('turns the viewer resuming into a room command', () => {
    sync.apply({ item: 'a', status: 'paused', pos: 5, at: timers.now, rate: 1 });
    timers.advance(3000);
    player.fire('playing');
    expect(commands).toEqual([expect.objectContaining({ type: 'play', pos: 5 })]);
  });

  it('hears a viewer pressing play soon after a pause', () => {
    sync.apply({ item: 'a', status: 'paused', pos: 5, at: timers.now, rate: 1 });
    timers.advance(900);
    player.fire('playing');
    expect(commands).toEqual([expect.objectContaining({ type: 'play' })]);
  });

  it('hears a viewer seeking while the room is paused', () => {
    sync.apply({ item: 'a', status: 'paused', pos: 5, at: timers.now, rate: 1 });
    timers.advance(3000);
    player.current = 40;
    sync.tick();
    expect(commands).toEqual([expect.objectContaining({ type: 'seek', pos: 40 })]);
  });

  it('turns a seek through the native controls into a room command', () => {
    sync.apply(playing(0, timers.now));
    run(3);
    player.current = 60;
    run(1);
    expect(commands).toEqual([expect.objectContaining({ type: 'seek' })]);
  });

  it('does not report its own catch-up as a viewer seek', () => {
    sync.apply(playing(0, timers.now));
    run(3);
    player.status = 'buffering'; // Falling behind without a jump in position.
    run(2);
    player.status = 'playing';
    run(12);
    expect(commands).toEqual([]);
  });

  it('reports the video ending', () => {
    sync.apply(playing(0, timers.now));
    run(3);
    player.fire('ended');
    expect(commands).toEqual([{ type: 'ended' }]);
  });

  it('puts a late joiner on the room timeline', () => {
    const playback = playing(0, timers.now - 90_000);
    sync.apply(playback);
    expect(player.status).toBe('playing');
    run(3);
    expect(Math.abs(drift(playback))).toBeLessThan(0.5);
  });

  it('does not nudge against a newer command', () => {
    const playback = playing(0, timers.now);
    sync.apply(playback);
    run(2);
    player.current -= 0.8;
    run(1);
    expect(player.rate).toBe(1.25);
    sync.apply({ item: 'a', status: 'paused', pos: 2, at: timers.now, rate: 1 });
    run(10);
    expect(player.status).toBe('paused');
    expect(player.rate).toBe(1);
  });
});
