import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerAdapter, PlayerError, PlayerRates, PlayerState } from '../players/types';
import { ServerClock } from './clock';
import { DRIFT_OK_S, expectedPosition, outOfReach, SyncController, type LocalCommand, type Playback, type SyncReport } from './controller';

/** A player whose clock only moves when the test says so. */
class FakePlayer implements PlayerAdapter {
  rates: PlayerRates = 'discrete';
  current = 0;
  rate = 1;
  status: PlayerState = 'paused';
  seeks: number[] = [];
  cues: number[] = [];
  length: number | null = null;
  private listener: (state: PlayerState) => void = () => {};

  play() { this.status = 'playing'; }
  pause() { this.status = 'paused'; }
  seek(seconds: number) { this.current = seconds; this.seeks.push(seconds); }
  cue(seconds: number) { this.current = seconds; this.cues.push(seconds); }
  setRate(rate: number) { this.rate = rate; }
  time() { return this.current; }
  state() { return this.status; }
  setMuted() {}
  muted() { return false; }
  setVolume() {}
  volume() { return 1; }
  duration() { return this.length; }
  onState(listener: (state: PlayerState) => void) { this.listener = listener; }
  onError(_listener: (error: PlayerError) => void) {}
  onBlocked(_listener: () => void) {}
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
  let unseen: boolean;

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

  /** A viewer's pause waits this long for a double-click to cancel it. */
  const pauseHeld = () => timers.advance(300);

  beforeEach(() => {
    player = new FakePlayer();
    timers = new FakeTimers();
    commands = [];
    reports = [];
    unseen = false;
    sync = new SyncController(
      player,
      { now: () => timers.now },
      (command) => commands.push(command),
      (report) => reports.push(report),
      timers,
      () => unseen,
    );
  });

  it('corrects at once when the clock is tuned after the first move, on a computer set ahead', () => {
    // Before the first ping answers, the clock is the computer's, 90 seconds out here.
    let skew = 90_000;
    const skewed = new SyncController(player, { now: () => timers.now + skew }, () => {}, () => {}, timers, () => unseen);
    const room = playing(10, timers.now);
    player.status = 'playing';
    skewed.apply(room);
    expect(player.time()).toBeGreaterThan(95);
    skew = 0;
    for (let i = 0; i < 3; i += 1) {
      timers.advance(1000);
      player.advance(1);
      skewed.tick();
    }
    expect(Math.abs(drift(room))).toBeLessThan(1);
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

  describe('a player that cannot change rate', () => {
    beforeEach(() => {
      player.rates = 'none';
    });

    it('leaves drift alone inside its wider target', () => {
      sync.apply(playing(0, timers.now));
      run(2);
      player.rate = 0.8; // Falls behind slowly, as a player does, not in a jump.
      run(6);
      expect(player.seeks).toEqual([]);
      expect(player.rate).toBe(0.8); // Nothing tried to nudge it either.
      expect(reports.at(-1)?.health).toBe('synced');
    });

    it('corrects by seeking alone, once past it', () => {
      const playback = playing(0, timers.now);
      sync.apply(playback);
      run(2);
      player.rate = 0.7;
      run(7);
      expect(player.seeks).toHaveLength(1);
      expect(player.rate).toBe(0.7); // No nudge touched it.
      expect(player.status).toBe('playing');
      expect(Math.abs(drift(playback))).toBeLessThan(1.5);
      expect(commands).toEqual([]);
    });
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
    pauseHeld();
    expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
  });

  describe('a tab out of sight', () => {
    it('keeps the room playing when the browser stops the player', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      unseen = true;
      player.fire('paused');
      pauseHeld();
      run(3);
      expect(commands).toEqual([]);
    });

    it('starts its own player again, and the room never hears of it', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      unseen = true;
      player.fire('paused');
      run(2);
      expect(player.status).toBe('playing');
      expect(commands).toEqual([]);
    });

    it('hears the viewer again once the tab is back', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      unseen = true;
      player.fire('paused');
      run(2);
      unseen = false;
      run(2);
      player.fire('paused');
      pauseHeld();
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('still sends a pause the viewer made just before leaving', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.fire('paused');
      unseen = true;
      pauseHeld();
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('counts a picture-in-picture window as still in reach', () => {
      expect(outOfReach({ hidden: true, pictureInPictureElement: null })).toBe(true);
      expect(outOfReach({ hidden: false, pictureInPictureElement: null })).toBe(false);
      expect(outOfReach({ hidden: true, pictureInPictureElement: {} as Element })).toBe(false);
    });
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

  describe('a stop somebody meant', () => {
    it('covers a pause the room has yet to hear about, or answer', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      expect(sync.stoppedOnPurpose()).toBe(false);
      player.fire('paused');
      expect(sync.stoppedOnPurpose()).toBe(true);
      pauseHeld();
      expect(sync.stoppedOnPurpose()).toBe(true);
    });

    it('covers falling back to the room', () => {
      sync.apply(playing(0, timers.now));
      run(2);
      player.current += 0.8;
      run(1);
      expect(player.status).toBe('paused');
      expect(sync.stoppedOnPurpose()).toBe(true);
    });
  });

  describe('the end of a video', () => {
    /** What YouTube can do with a seek past the end: start the video again. */
    const restartsOnSeek = () => {
      player.seek = (target) => { player.seeks.push(target); player.current = 0; player.fire('playing'); };
    };
    const finish = () => {
      player.length = 195;
      const room = playing(190, timers.now);
      sync.apply(room);
      run(3);
      player.current = 195;
      player.fire('ended');
      player.seeks = [];
      commands.length = 0;
      return room;
    };
    const ended = () => commands.filter((command) => command.type === 'ended');

    it('does not blame a viewer when the report of the end got lost', () => {
      finish();
      restartsOnSeek();
      run(8);
      expect(commands.filter((command) => command.type === 'seek')).toEqual([]);
      expect(player.seeks).toEqual([]);
    });

    it('keeps telling the room until it moves on', () => {
      finish();
      run(6);
      expect(ended().length).toBeGreaterThanOrEqual(2);
      expect(ended().length).toBeLessThanOrEqual(3);
    });

    it('stops once the room has moved on', () => {
      finish();
      sync.apply(playing(0, timers.now));
      commands.length = 0;
      run(4);
      expect(ended()).toEqual([]);
    });

    it('does not start a finished video again when the room repeats itself', () => {
      const room = finish();
      player.play = () => { throw new Error('played a finished video'); };
      sync.apply(room, true);
      expect(player.seeks).toEqual([]);
    });

    it('ignores a video that starts itself again', () => {
      finish();
      player.current = 0;
      player.fire('playing');
      run(2);
      expect(commands.filter((command) => command.type === 'seek')).toEqual([]);
    });

    it('follows the room back when someone really does go back', () => {
      finish();
      sync.apply(playing(20, timers.now));
      expect(player.seeks).toHaveLength(1);
      expect(player.status).toBe('playing');
    });

    it('tells the room when its clock has run past the end, even if this player never got there', () => {
      player.length = 195;
      sync.apply(playing(190, timers.now));
      player.current = 100;
      commands.length = 0;
      timers.advance(6000);
      sync.tick();
      expect(ended()).toHaveLength(1);
    });

    it('never corrects to a spot past the end', () => {
      player.length = 195;
      sync.apply(playing(194.9, timers.now));
      expect(player.seeks).toHaveLength(1);
      expect(player.seeks[0]).toBeLessThan(195);
    });

    it('carries on as before when the length is not known', () => {
      sync.apply(playing(100, timers.now));
      expect(player.seeks).toEqual([100.25]);
    });
  });

  describe('what the viewer is told', () => {
    const lastHealth = () => reports.at(-1)?.health;

    it('stays in sync through a correction nobody can see', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.current -= 0.3;
      run(1);
      expect(lastHealth()).toBe('synced');
    });

    it('does not say in sync during a nudge', () => {
      player.rates = 'fine';
      sync.apply(playing(0, timers.now));
      run(3);
      player.current -= 0.8;
      for (let i = 0; i < 6; i += 1) {
        run(1);
        expect(lastHealth()).toBe('correcting');
      }
    });

    it('does not wait to say it has fallen behind', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.current -= 2;
      run(1);
      expect(reports.at(-1)).toMatchObject({ health: 'correcting' });
    });

    it('does not call a stopped player in sync, however close it is', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.fire('paused');
      expect(lastHealth()).toBe('correcting');
      timers.advance(100);
      sync.tick();
      expect(lastHealth()).toBe('correcting');
    });

    it('takes back what a viewer\'s own pause said once the room has paused', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.fire('paused');
      expect(lastHealth()).toBe('correcting');
      sync.apply({ item: 'a', status: 'paused', pos: player.current, at: timers.now, rate: 1 });
      expect(reports.at(-1)).toEqual({ health: 'waiting', drift: 0 });
      run(3);
      expect(lastHealth()).toBe('waiting');
    });

    it('stops saying in sync the moment the room moves it', () => {
      sync.apply(playing(0, timers.now));
      run(3);
      expect(lastHealth()).toBe('synced');
      player.seek = () => {}; // Accepted, not landed yet.
      sync.apply(playing(90, timers.now));
      expect(lastHealth()).toBe('correcting');
    });

    it('does not call a player the browser never started in sync', () => {
      player.status = 'ready';
      player.play = () => {};
      sync.apply(playing(0, timers.now));
      timers.advance(1000);
      sync.tick();
      expect(lastHealth()).toBe('correcting');
    });
  });

  describe('coming back from buffering', () => {
    const stall = (seconds: number) => {
      const room = playing(0, timers.now);
      sync.apply(room);
      run(5);
      player.seeks = [];
      player.fire('buffering');
      timers.advance(seconds * 1000);
      sync.tick();
      return room;
    };

    it('goes straight to the room the moment it plays', () => {
      const room = stall(2);
      player.fire('playing');
      expect(player.seeks).toHaveLength(1);
      expect(Math.abs(drift(room))).toBeLessThan(0.3);
      expect(commands).toEqual([]);
    });

    it('is not held back by the seek that put it on the room', () => {
      const room = playing(100, timers.now);
      sync.apply(room); // Joining: this seek lands seconds late.
      player.fire('buffering');
      timers.advance(4000);
      sync.tick();
      player.current = 100;
      player.seeks = [];
      player.fire('playing');
      expect(player.seeks).toHaveLength(1);
      expect(Math.abs(drift(room))).toBeLessThan(0.3);
    });

    it('nudges when it lost too little to be worth a jump', () => {
      stall(0.3);
      player.fire('playing');
      run(1);
      expect(player.seeks).toEqual([]);
      expect(player.rate).toBe(1.25);
    });

    it('gives up a nudge that buffering overtook', () => {
      const room = playing(0, timers.now);
      sync.apply(room);
      run(3);
      player.current -= 0.8;
      run(1);
      expect(player.rate).toBe(1.25);
      player.seeks = [];
      player.fire('buffering');
      timers.advance(1000);
      sync.tick();
      player.fire('playing');
      expect(player.seeks).toHaveLength(1);
      expect(player.rate).toBe(1);
    });

    it('can jump again once the last jump has held', () => {
      stall(2);
      player.fire('playing');
      run(6);
      player.seeks = [];
      player.fire('buffering');
      timers.advance(2000);
      sync.tick();
      player.fire('playing');
      expect(player.seeks).toHaveLength(1);
    });

    it('does not keep jumping on a connection that cannot keep up', () => {
      stall(2);
      player.fire('playing');
      for (let i = 0; i < 4; i += 1) {
        run(2);
        player.fire('buffering');
        timers.advance(1000);
        sync.tick();
        player.fire('playing');
      }
      expect(player.seeks.length).toBeLessThanOrEqual(2);
    });
  });

  describe('falling behind without buffering', () => {
    const slip = () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.seeks = [];
      timers.advance(1500); // The clock moves on and the player doesn't.
      sync.tick();
    };

    it('jumps on YouTube, where a nudge would take four times the gap', () => {
      slip();
      expect(player.seeks).toHaveLength(1);
      expect(player.rate).toBe(1);
      expect(commands).toEqual([]);
    });

    it('nudges a file, which can do it gently', () => {
      player.rates = 'fine';
      slip();
      expect(player.seeks).toEqual([]);
      expect(player.rate).toBeCloseTo(1.05);
    });

    it('nudges YouTube while it may not jump', () => {
      slip();
      run(3);
      player.seeks = [];
      timers.advance(1500);
      sync.tick();
      expect(player.seeks).toEqual([]);
      expect(player.rate).toBe(1.25);
    });
  });

  describe('how far a seek aims past the room', () => {
    it('barely at all for a file, which seeks at once', () => {
      player.rates = 'fine';
      sync.apply(playing(100, timers.now));
      expect(player.seeks).toEqual([100.05]);
    });

    const landsShortBy = (seconds: number) => {
      player.seek = (target) => { player.current = target - seconds; player.seeks.push(target); };
    };
    const stallThenPlay = () => {
      sync.apply(playing(0, timers.now));
      run(3);
      player.seeks = [];
      player.fire('buffering');
      timers.advance(3000);
      sync.tick();
      player.fire('playing');
    };

    it('tries once more when a jump lands short', () => {
      landsShortBy(1.5);
      stallThenPlay();
      run(3);
      expect(player.seeks).toHaveLength(2);
      expect((player.seeks[1] ?? 0) - (player.seeks[0] ?? 0)).toBeGreaterThan(2);
    });

    it('stops at that one retry', () => {
      landsShortBy(2.5); // More than the longest lead can make up, so the retry falls short too.
      stallThenPlay();
      run(8);
      expect(player.seeks).toHaveLength(2);
    });

    it('earns the retry back once a jump has held', () => {
      landsShortBy(1.5);
      stallThenPlay();
      run(6);
      player.seeks = [];
      landsShortBy(3);
      player.fire('buffering');
      timers.advance(2000);
      sync.tick();
      player.fire('playing');
      run(3);
      expect(player.seeks).toHaveLength(2);
    });

    it('learns from a seek that landed behind', () => {
      const room = playing(0, timers.now);
      sync.apply(room);
      run(3);
      // It costs a second more than the lead allows.
      player.seek = (seconds) => { player.current = seconds - 1; player.seeks.push(seconds); };
      player.fire('buffering');
      timers.advance(3000);
      sync.tick();
      player.fire('playing');
      run(2);
      player.seeks = [];
      timers.advance(11_000);
      sync.tick();
      expect((player.seeks[0] ?? 0) - expectedPosition(room, timers.now)).toBeGreaterThan(0.9);
    });
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
      pauseHeld();
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
      pauseHeld();
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
      sync = new SyncController(player, { now: () => timers.now }, (command) => commands.push(command), (report) => reports.push(report), timers, () => unseen);
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
      pauseHeld();
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
      pauseHeld();
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
    });

    it('hears a pause while a play is still buffering', () => {
      player.status = 'paused';
      sync.apply(playing(0, timers.now));
      player.status = 'paused';
      player.fire('buffering');
      player.fire('paused');
      pauseHeld();
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
      pauseHeld();
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
      pauseHeld();
      expect(commands.map((c) => c.type)).toEqual(['play', 'pause']);
    });

    it('ends up where the viewer did once both answers come', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused');
      pauseHeld();
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
      pauseHeld();
      expect(commands.map((c) => c.type)).toEqual(['pause', 'pause']);
    });

    it('forgets the command when the room moves on without it', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused');
      pauseHeld();
      sync.apply({ item: 'a', status: 'idle', pos: 0, at: timers.now, rate: 1 });
      player.fire('playing');
      expect(commands.map((c) => c.type)).toEqual(['pause']);
    });

    it('does not repeat a command the room has yet to answer', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      commands.length = 0;
      player.fire('paused');
      pauseHeld();
      player.fire('paused');
      pauseHeld();
      expect(commands.map((c) => c.type)).toEqual(['pause']);
    });
  });

  describe('a pause that is not one', () => {
    const playingAt = (time: number) => {
      sync.apply(playing(time, timers.now));
      player.current = time;
      run(3);
      commands.length = 0;
      player.seeks = [];
    };

    it('tells the room nothing about a double-click', () => {
      playingAt(30);
      player.fire('paused');
      timers.advance(150);
      player.fire('playing');
      run(3);
      expect(commands).toEqual([]);
      expect(player.state()).toBe('playing');
    });

    it('tells the room nothing when a double-click passes through buffering', () => {
      playingAt(30);
      player.fire('paused');
      player.fire('buffering');
      timers.advance(260);
      player.fire('playing');
      run(3);
      expect(commands).toEqual([]);
    });

    it('takes a click on the timeline for a seek', () => {
      playingAt(30);
      player.current = 165;
      player.fire('paused');
      player.fire('playing');
      expect(commands).toEqual([expect.objectContaining({ type: 'seek', pos: 165 })]);
    });

    it('takes a drag along the timeline for one seek', () => {
      playingAt(30);
      player.current = 87;
      player.fire('paused');
      for (const time of [118, 150, 181, 212]) {
        timers.advance(500);
        player.current = time;
        timers.advance(500);
        sync.tick();
      }
      expect(commands).toEqual([]);
      expect(player.seeks).toEqual([]);
      player.fire('playing');
      expect(commands).toEqual([expect.objectContaining({ type: 'seek', pos: 212 })]);
    });

    it('pauses the room where a viewer lets go of a paused drag', () => {
      playingAt(30);
      player.current = 87;
      player.fire('paused');
      timers.advance(500);
      player.current = 118;
      timers.advance(500); // It moved, so it looks again.
      timers.advance(1000);
      expect(commands).toEqual([expect.objectContaining({ type: 'pause', pos: 118 })]);
    });

    it('does not resume a pause it is holding', () => {
      playingAt(30);
      player.current = 87;
      player.fire('paused');
      timers.advance(900);
      sync.tick();
      expect(player.state()).toBe('paused');
    });

    it('keeps the pause when someone else moves the room first', () => {
      playingAt(30);
      player.fire('paused');
      timers.advance(100);
      sync.apply(playing(90, timers.now));
      expect(commands).toEqual([expect.objectContaining({ type: 'pause' })]);
      expect(player.state()).toBe('paused');
    });

    it('still follows the room when the player was only buffering', () => {
      playingAt(30);
      player.fire('paused');
      player.fire('buffering');
      timers.advance(100);
      sync.apply(playing(90, timers.now));
      expect(commands).toEqual([]);
      expect(player.seeks.at(-1)).toBeGreaterThan(89);
    });

    it('forgets the pause when the room pauses first', () => {
      playingAt(30);
      player.fire('paused');
      timers.advance(100);
      sync.apply({ item: 'a', status: 'paused', pos: 30, at: timers.now, rate: 1 });
      run(1);
      expect(commands).toEqual([]);
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

    it('resumes a refused pause as soon as the room says no', () => {
      const room = playing(0, timers.now);
      sync.apply(room);
      run(3);
      player.fire('paused');
      pauseHeld();
      sync.apply({ ...room }, true); // The snapshot sent with the refusal.
      expect(player.status).toBe('playing');
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

    it('hears a seek that lands as it comes out of buffering', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      player.status = 'buffering';
      timers.advance(1010);
      sync.tick();
      player.status = 'playing';
      player.current += 30;
      timers.advance(1010);
      sync.tick();
      expect(commands).toEqual([expect.objectContaining({ type: 'seek', pos: player.current })]);
      expect(player.seeks).toEqual([]);
    });

    it('does not take the time lost to buffering for a seek', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      player.status = 'buffering';
      for (let i = 0; i < 2; i += 1) {
        timers.advance(1010);
        sync.tick();
      }
      player.status = 'playing';
      jittered(1.1);
      expect(commands).toEqual([]);
    });

    it('leaves a viewer seeking through a long buffer alone, then moves the room', () => {
      sync.apply(roomAt(timers.now));
      jittered(5);
      commands = [];
      player.current = 317;
      player.status = 'buffering';
      for (let i = 0; i < 6; i += 1) {
        timers.advance(1010);
        sync.tick();
      }
      player.status = 'playing';
      jittered(1.1);
      expect(commands).toEqual([expect.objectContaining({ type: 'seek' })]);
      expect(player.seeks).toEqual([]);
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

  describe('just after the room resumes', () => {
    const restAt50 = () => {
      sync.apply({ item: 'a', status: 'paused', pos: 50, at: timers.now, rate: 1 });
      timers.advance(1000);
      sync.tick();
      timers.advance(1000);
      sync.tick();
      player.seeks = [];
    };
    const resumed = () => {
      restAt50();
      sync.apply(playing(50, timers.now));
    };

    it('hears a seek made before the next tick', () => {
      resumed();
      timers.advance(500);
      player.current = 110;
      run(1);
      expect(commands).toEqual([expect.objectContaining({ type: 'seek' })]);
      expect(player.seeks).toEqual([]);
    });

    it('does not move the room when nobody touched anything', () => {
      resumed();
      run(4);
      expect(commands).toEqual([]);
    });

    it('does not hand a room seek back after buffering its way there', () => {
      sync.apply(playing(60, timers.now));
      run(3);
      commands.length = 0;
      sync.apply(playing(480, timers.now));
      player.fire('buffering');
      timers.advance(1000);
      sync.tick(); // The seek lands here, while the player is still buffering.
      timers.advance(2000);
      sync.tick();
      player.fire('playing');
      expect(commands).toEqual([]);
    });

    it('still hears a seek made after its own one landed', () => {
      sync.apply(playing(60, timers.now));
      run(3);
      sync.apply(playing(480, timers.now));
      run(3);
      commands.length = 0;
      player.fire('buffering');
      player.current = 100;
      timers.advance(1000);
      sync.tick();
      player.fire('playing');
      expect(commands).toEqual([expect.objectContaining({ type: 'seek', pos: 100 })]);
    });

    it('does not take its own jump to the room for a viewer seek', () => {
      restAt50();
      sync.apply(playing(120, timers.now)); // Someone moved it as it resumed.
      run(4);
      expect(commands).toEqual([]);
    });

    it('does not take a joiner landing on the room for a viewer seek', () => {
      const landed: number[] = [];
      player.seek = (seconds) => { landed.push(seconds); };
      sync.apply({ item: 'a', status: 'paused', pos: 600, at: timers.now, rate: 1 });
      timers.advance(1000);
      sync.tick(); // Still reporting 0, so never seen on the room's position.
      sync.apply(playing(600, timers.now));
      player.status = 'playing';
      timers.advance(1000);
      player.current = 601;
      sync.tick();
      expect(commands).toEqual([]);
    });
  });

  describe('a seek by someone else', () => {
    it('reaches a viewer at once, however short the move', () => {
      const room = playing(0, timers.now);
      sync.apply(room);
      run(5);
      sync.apply(playing(7.5, timers.now));
      expect(player.seeks.at(-1)).toBeCloseTo(7.75);
      expect(player.rate).toBe(1);
      expect(commands).toEqual([]);
    });

    it('leaves a viewer already there alone', () => {
      sync.apply(playing(0, timers.now));
      run(5);
      sync.apply(playing(5.05, timers.now));
      expect(player.seeks).toEqual([]);
    });
  });

  describe('paused room', () => {
    const paused = (pos: number): Playback => ({ item: 'a', status: 'paused', pos, at: timers.now, rate: 1 });
    const tick = (ms = 1000) => {
      timers.advance(ms);
      sync.tick();
    };

    describe('with a player that has not started', () => {
      beforeEach(() => { player.status = 'ready'; });

      it('cues it at the room position, without seeking or pausing it', () => {
        sync.apply(paused(724));
        for (let i = 0; i < 4; i += 1) tick();
        expect(player.cues).toEqual([724]);
        expect(player.seeks).toEqual([]);
        expect(player.status).toBe('ready');
        expect(commands).toEqual([]);
      });

      it('cues it again when the room moves', () => {
        sync.apply(paused(724));
        tick();
        sync.apply(paused(800));
        expect(player.cues).toEqual([724, 800]);
      });

      it('takes a click on its play button for a resume', () => {
        sync.apply(paused(724));
        tick(3000);
        player.fire('buffering');
        player.fire('playing');
        expect(commands).toEqual([expect.objectContaining({ type: 'play', pos: 724 })]);
        tick();
        expect(player.status).toBe('playing');
      });

      it('starts it when the room resumes', () => {
        sync.apply(paused(724));
        tick();
        sync.apply(playing(724, timers.now));
        expect(player.status).toBe('playing');
        expect(commands).toEqual([]);
      });
    });

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
