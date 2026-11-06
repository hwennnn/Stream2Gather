import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerAdapter, PlayerError, PlayerRates, PlayerState } from '../players/types';
import { ServerClock } from './clock';
import { DRIFT_OK_S, expectedPosition, SyncController, type LocalCommand, type Playback, type SyncReport } from './controller';

/** A player whose clock only moves when the test says so. */
class FakePlayer implements PlayerAdapter {
  rates: PlayerRates = 'discrete';
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
    expect(clock.offset).toBe(1950);
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
    player.rates = 'fine';
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

  describe('events that repeat the same playback', () => {
    const lockToggle = (playback: Playback) => sync.apply({ ...playback });

    /** What a viewer pressing pause in the native controls looks like. */
    const viewerPauses = () => player.fire('paused');

    it.each([100, 500, 1200])('hears a pause %dms after a lock toggle', (delay) => {
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(3);
      lockToggle(playback);
      timers.advance(delay);
      viewerPauses();
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('does not undo that pause while the room answers', () => {
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(3);
      lockToggle(playback);
      timers.advance(100);
      viewerPauses();
      run(1);
      expect(player.status).toBe('paused');
      sync.apply({ ...playback, status: 'paused', pos: player.time(), at: timers.now });
      run(3);
      expect(player.status).toBe('paused');
      expect(commands.length).toBe(1);
    });

    it('hears a seek right after a lock toggle, and leaves it be', () => {
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(3);
      lockToggle(playback);
      player.current = 60;
      run(1);
      expect(commands).toEqual([expect.objectContaining({ type: 'seek' })]);
      expect(player.seeks).toEqual([]);
      expect(player.current).toBeGreaterThan(60);
    });

    it('hears a play right after an event in a paused room', () => {
      const playback: Playback = { item: 'a', status: 'paused', pos: 5, at: timers.now, rate: 1 };
      sync.apply(playback);
      run(3);
      lockToggle(playback);
      timers.advance(100);
      player.fire('playing');
      expect(commands).toEqual([expect.objectContaining({ type: 'play' })]);
    });

    it('does not touch the player at all', () => {
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(3);
      player.seeks = [];
      player.current += 1;
      player.play = () => { throw new Error('played'); };
      player.pause = () => { throw new Error('paused'); };
      lockToggle(playback);
      expect(player.seeks).toEqual([]);
    });

    it('does not cut a nudge short', () => {
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(2);
      player.current -= 0.8;
      run(1);
      expect(player.rate).toBe(1.25);
      lockToggle(playback);
      expect(player.rate).toBe(1.25);
    });

    it('always goes through when the room insists', () => {
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(3);
      player.status = 'paused'; // A pause the room refused.
      sync.apply({ ...playback }, true);
      expect(player.status).toBe('playing');
    });
  });

  describe('during a nudge', () => {
    const nudged = () => {
      player.rates = 'fine';
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(2);
      player.current -= 1; // Twenty seconds of nudging at 1.05.
      run(1);
      expect(player.rate).toBeCloseTo(1.05);
      run(5);
      expect(player.rate).toBeCloseTo(1.05);
      return playback;
    };

    it('hears a pause', () => {
      nudged();
      player.fire('paused');
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('hears a seek', () => {
      nudged();
      player.current += 60;
      run(1);
      expect(commands).toEqual([expect.objectContaining({ type: 'seek' })]);
    });

    it('does not take the nudge itself for a seek', () => {
      nudged();
      run(20);
      expect(commands).toEqual([]);
    });

    it('stops once the pause lands', () => {
      const playback = nudged();
      player.fire('paused');
      sync.apply({ ...playback, status: 'paused', pos: player.time(), at: timers.now });
      expect(player.rate).toBe(1);
      run(3);
      expect(player.status).toBe('paused');
    });

    it('does not resume a player it paused to fall back', () => {
      sync.apply(playing(0, timers.now));
      run(2);
      // Comes out of buffering 1.9s ahead, which holds it for longer than settling.
      player.status = 'buffering';
      timers.advance(1000);
      sync.tick();
      player.current += 3.9; // Two seconds passed, so this is 1.9s ahead.
      player.status = 'playing';
      timers.advance(1000);
      sync.tick();
      expect(player.status).toBe('paused');
      timers.advance(1600);
      sync.tick();
      expect(player.status).toBe('paused');
      timers.advance(400);
      expect(player.status).toBe('playing');
    });
  });

  describe('expected echoes', () => {
    /** Reports changes late, the way a real player does. */
    class EchoingPlayer extends FakePlayer {
      latency = 120;
      override play() { this.change('playing'); }
      override pause() { this.change('paused'); }
      private change(state: PlayerState) {
        if (this.status === state) return; // A real player says nothing then.
        timers.setTimeout(() => this.fire(state), this.latency);
      }
    }

    const useEchoes = (start: PlayerState = 'paused') => {
      const echoing = new EchoingPlayer();
      echoing.status = start;
      player = echoing;
      sync = new SyncController(player, { now: () => timers.now }, (command) => commands.push(command), (report) => reports.push(report), timers);
      return echoing;
    };

    it('recognises its own pause however late the echo', () => {
      const echoing = useEchoes();
      sync.apply(playing(0, timers.now));
      run(3);
      echoing.latency = 4000;
      sync.apply({ item: 'a', status: 'paused', pos: 3, at: timers.now, rate: 1 });
      run(6);
      expect(player.status).toBe('paused');
      expect(commands).toEqual([]);
    });

    it('recognises its own play when the room pauses again straight away', () => {
      sync.apply({ item: 'a', status: 'paused', pos: 3, at: timers.now, rate: 1 });
      run(2);
      const resumed = playing(3, timers.now);
      sync.apply(resumed);
      sync.apply({ ...resumed, status: 'paused' });
      player.fire('playing');
      player.fire('paused');
      expect(commands).toEqual([]);
    });

    it('takes a pause landing behind its own play for an echo', () => {
      useEchoes('playing');
      const room = playing(0, timers.now);
      sync.apply(room);
      run(2);
      sync.apply({ ...room, status: 'paused', pos: 2, at: timers.now });
      sync.apply({ ...room, pos: 2, at: timers.now });
      run(3);
      expect(commands).toEqual([]);
    });

    it('does not take a player already starting for the viewer', () => {
      useEchoes('buffering');
      sync.apply({ item: 'a', status: 'paused', pos: 3, at: timers.now, rate: 1 });
      player.fire('playing'); // Queued before the pause reached the player.
      expect(commands).toEqual([]);
    });

    it('expects nothing from a player already where it was sent', () => {
      useEchoes('paused');
      sync.apply({ item: 'a', status: 'paused', pos: 3, at: timers.now, rate: 1 });
      player.fire('playing');
      expect(commands).toEqual([expect.objectContaining({ type: 'play' })]);
    });

    it('hears the viewer once its own echo has come', () => {
      useEchoes();
      sync.apply(playing(0, timers.now));
      run(1);
      player.fire('paused');
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('stops waiting for a command that changed nothing it could report', () => {
      // A file told to pause before it ever played fires no pause event.
      player.status = 'loading';
      sync.apply({ item: 'a', status: 'paused', pos: 0, at: timers.now, rate: 1 });
      run(1);
      const room = playing(0, timers.now);
      sync.apply(room);
      run(3);
      player.fire('paused');
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('hears a pause while a play is still buffering', () => {
      player.status = 'paused';
      sync.apply(playing(0, timers.now));
      player.status = 'paused';
      player.fire('buffering');
      player.fire('paused');
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('still ignores its own corrective pause', () => {
      useEchoes('playing');
      const room = playing(0, timers.now);
      sync.apply(room);
      run(2);
      player.current += 0.8;
      run(4);
      expect(commands).toEqual([]);
      expect(player.status).toBe('playing');
    });
  });

  describe('before the room has answered', () => {
    const paused = (pos: number, at: number): Playback => ({ item: 'a', status: 'paused', pos, at, rate: 1 });

    it('hears a play right after this viewer paused', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused');
      timers.advance(100);
      player.fire('playing');
      expect(commands.map((c) => c.type)).toEqual(['pause', 'play']);
    });

    it('hears a pause right after this viewer played', () => {
      sync.apply(paused(5, timers.now));
      run(5);
      commands.length = 0;
      player.fire('playing');
      timers.advance(100);
      player.fire('paused');
      expect(commands.map((c) => c.type)).toEqual(['play', 'pause']);
    });

    it('ends up where the viewer did once both answers come', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused');
      timers.advance(100);
      player.fire('playing');
      const pos = player.time();
      sync.apply(paused(pos, timers.now));
      player.fire('paused');
      sync.apply(playing(pos, timers.now));
      player.fire('playing');
      run(3);
      expect(player.state()).toBe('playing');
      expect(commands.map((c) => c.type)).toEqual(['pause', 'play']);
    });

    it('goes back to the room once the viewer has been waiting too long', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused'); // The room never answers.
      run(3);
      expect(player.state()).toBe('playing');
      player.fire('paused');
      expect(commands.map((c) => c.type)).toEqual(['pause', 'pause']);
    });

    it('forgets the command when the room moves on without it', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused');
      sync.apply({ item: 'a', status: 'idle', pos: 0, at: timers.now, rate: 1 });
      player.fire('playing');
      expect(commands.map((c) => c.type)).toEqual(['pause']);
    });

    it('does not repeat a command the room has yet to answer', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused');
      player.fire('paused');
      expect(commands.map((c) => c.type)).toEqual(['pause']);
    });
  });

  describe('a viewer the room said no to', () => {
    it('resumes a refused pause once the room has had time to answer', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.status = 'paused';
      player.fire('paused');
      expect(player.status).toBe('paused');
      run(1);
      expect(player.status).toBe('paused');
      run(1);
      expect(player.status).toBe('playing');
      expect(commands.length).toBe(1);
    });

    it('puts a refused seek back', () => {
      const room = playing(0, timers.now);
      sync.apply(room);
      run(3);
      player.current = 60;
      run(1);
      sync.apply({ ...room }, true); // The snapshot sent with the refusal.
      run(1);
      expect(Math.abs(drift(room))).toBeLessThan(0.5);
    });
  });

  describe('telling a viewer from a hiccup', () => {
    const roomAt = (at: number): Playback => ({ item: 'a', status: 'playing', pos: 0, at, rate: 1 });

    /** Ticks at a browser's real, slightly late, pace. */
    const jittered = (seconds: number, tickMs = 1010) => {
      let sinceTick = 0;
      for (let i = 0; i < seconds * 100; i += 1) {
        timers.advance(10);
        player.advance(0.01);
        sinceTick += 10;
        if (sinceTick >= tickMs) {
          sync.tick();
          sinceTick = 0;
        }
      }
    };

    /** The player stops moving but keeps saying it is playing. */
    const freeze = (ticks: number, tickMs = 1010) => {
      const frozen = player.current;
      for (let i = 0; i < ticks; i += 1) {
        timers.advance(tickMs);
        player.current = frozen;
        sync.tick();
      }
    };

    it('does not take a frozen player for a seek, on a jittered tick', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      freeze(2);
      expect(commands).toEqual([]);
    });

    it('does not take a long stall for a seek', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      freeze(8);
      expect(commands).toEqual([]);
    });

    it('does not take recovering from a stall for a seek', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      freeze(2);
      commands = [];
      jittered(3);
      expect(commands).toEqual([]);
    });

    it('still hears a real seek on a jittered tick', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      player.current += 30;
      jittered(1.1);
      expect(commands).toEqual([expect.objectContaining({ type: 'seek' })]);
    });

    it('still hears a real seek backwards', () => {
      sync.apply(roomAt(timers.now));
      jittered(30);
      commands = [];
      player.current -= 15;
      jittered(1.1);
      expect(commands).toEqual([expect.objectContaining({ type: 'seek' })]);
    });

    it('never infers a seek while buffering', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      player.status = 'buffering';
      for (let i = 0; i < 3; i += 1) {
        timers.advance(1010);
        player.current += 5;
        sync.tick();
      }
      expect(commands).toEqual([]);
    });

    it('needs two playing ticks in a row', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      player.status = 'buffering';
      timers.advance(1010);
      sync.tick();
      player.status = 'playing';
      player.current += 30; // Lands as it comes out of buffering.
      timers.advance(1010);
      sync.tick();
      expect(commands).toEqual([]);
    });

    it('ignores the gap a throttled tab leaves', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      timers.advance(60_000);
      player.current += 5;
      sync.tick();
      expect(commands).toEqual([]);
    });

    it('lets a slow join in a playing room land without moving the room', () => {
      player.status = 'buffering';
      const landed: number[] = [];
      player.seek = (seconds) => { landed.push(seconds); };
      sync.apply({ item: 'a', status: 'playing', pos: 100, at: timers.now, rate: 1 });
      for (let i = 0; i < 5; i += 1) {
        timers.advance(1000);
        sync.tick();
      }
      player.current = landed[0] ?? 0;
      player.status = 'playing';
      timers.advance(1000);
      sync.tick();
      expect(commands).toEqual([]);
    });
  });

  describe('paused room', () => {
    const paused = (pos: number): Playback => ({ item: 'a', status: 'paused', pos, at: timers.now, rate: 1 });
    const tick = (ms = 1000) => {
      timers.advance(ms);
      sync.tick();
    };

    it('paused late joiner emits nothing', () => {
      const landed: number[] = [];
      player.seek = (seconds) => { landed.push(seconds); }; // Accepted, not landed yet.
      player.status = 'buffering';
      sync.apply(paused(600));
      for (let i = 0; i < 5; i += 1) tick();
      expect(commands).toEqual([]);
    });

    it('re-seeks a joiner still reporting 0, and only locally', () => {
      const landed: number[] = [];
      player.seek = (seconds) => { landed.push(seconds); };
      sync.apply(paused(600));
      landed.length = 0;
      for (let i = 0; i < 4; i += 1) tick();
      expect(landed.length).toBeGreaterThan(0);
      expect(landed.every((seconds) => seconds === 600)).toBe(true);
      expect(commands).toEqual([]);
    });

    it('does nothing at all until the player says paused', () => {
      sync.apply(paused(600));
      player.status = 'buffering';
      player.seeks = [];
      for (let i = 0; i < 4; i += 1) tick();
      expect(player.seeks).toEqual([]);
      expect(commands).toEqual([]);
    });

    it('treats leaving the room position as a seek once settled', () => {
      sync.apply(paused(600));
      tick();
      tick();
      player.current = 40;
      tick();
      expect(commands).toEqual([expect.objectContaining({ type: 'seek', pos: 40 })]);
    });

    it('needs the player to settle again after the room moves', () => {
      const landed: number[] = [];
      sync.apply(paused(100));
      tick();
      tick();
      player.seek = (seconds) => { landed.push(seconds); };
      sync.apply(paused(700));
      for (let i = 0; i < 4; i += 1) tick();
      expect(commands).toEqual([]);
    });

    it('turns a viewer playing into a room command, once', () => {
      sync.apply(paused(5));
      tick(3000);
      player.fire('playing');
      expect(commands).toEqual([expect.objectContaining({ type: 'play', pos: 5 })]);
      tick(500);
      expect(commands.length).toBe(1);
    });

    it('leaves that player running while the room answers', () => {
      sync.apply(paused(5));
      tick(3000);
      player.fire('playing');
      tick(500);
      expect(player.status).toBe('playing');
      sync.apply(playing(5, timers.now));
      for (let i = 0; i < 4; i += 1) tick();
      expect(player.status).toBe('playing');
    });

    it('does not let a viewer play alone when the room never agrees', () => {
      sync.apply(paused(5));
      tick(3000);
      player.fire('playing');
      for (let i = 0; i < 3; i += 1) tick();
      expect(player.status).toBe('paused');
      expect(commands.length).toBe(1);
    });

    it('stops at once when the room refuses', () => {
      const room = paused(5);
      sync.apply(room);
      tick(3000);
      player.fire('playing');
      sync.apply({ ...room }, true); // The snapshot sent with the refusal.
      expect(player.status).toBe('paused');
    });

    it('stops a player it never heard start', () => {
      sync.apply(paused(5));
      tick(3000);
      player.status = 'playing';
      tick();
      expect(player.status).toBe('paused');
      expect(commands).toEqual([]);
    });

    it('stays settled when the same pause is applied again', () => {
      sync.apply(paused(100));
      tick();
      tick();
      sync.apply(paused(100));
      tick();
      tick();
      player.current = 40;
      tick();
      expect(commands).toEqual([expect.objectContaining({ type: 'seek', pos: 40 })]);
    });
  });

  describe('ServerClock sampling', () => {
    it('stays on whole milliseconds with an odd round trip', () => {
      const clock = new ServerClock(() => 1_000_000);
      clock.addSample(1000, 2000, 1041); // rtt 41, so the offset ends in .5
      expect(Number.isInteger(clock.now())).toBe(true);
    });

    it('ignores a sample where the wall clock stepped back', () => {
      const clock = new ServerClock(() => 1_000_000);
      clock.addSample(1000, 2000, 1040);
      clock.addSample(5000, 6000, 3000);
      expect(clock.offset).toBe(980);
    });
  });
});
