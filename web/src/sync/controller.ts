import type { PlayerAdapter, PlayerState } from '../players/types';

export type Playback = {
  item: string;
  status: 'idle' | 'playing' | 'paused';
  pos: number;
  at: number;
  rate: number;
};

export type LocalCommand =
  | { type: 'play' | 'pause' | 'seek'; pos: number; ct: number }
  | { type: 'ended' };

export type SyncHealth = 'synced' | 'correcting' | 'buffering' | 'waiting' | 'stalled';

export type SyncReport = { health: SyncHealth; drift: number };

type Clock = { now(): number };

type Timers = {
  setTimeout(work: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

const browserTimers: Timers = {
  setTimeout: (work, ms) => window.setTimeout(work, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

/** Below this, viewers cannot perceive the gap and correcting only adds risk. */
export const DRIFT_OK_S = 0.15;
const NUDGE_AHEAD_MAX_S = 2;
const NUDGE_BEHIND_MAX_S = 3;
const CATCH_UP_RATE = 1.25;
const FINE_RATE_DELTA = 0.05;
const SEEK_SETTLE_S = 0.25;
const SEEK_COOLDOWN_MS = 10_000;
/** Player events this soon after our own action are echoes, not the viewer. */
const ECHO_WINDOW_MS = 1500;
/**
 * A player that starts while the room is paused is almost certainly the viewer
 * pressing play, so that direction only ignores a sliver of time.
 */
const RESUME_ECHO_WINDOW_MS = 300;
const USER_SEEK_THRESHOLD_S = 1;
const STALL_TICKS = 3;

export const expectedPosition = (playback: Playback, serverNow: number): number => {
  if (playback.status !== 'playing' || serverNow <= playback.at) return playback.pos;
  return playback.pos + ((serverNow - playback.at) / 1000) * playback.rate;
};

/**
 * Keeps one player on the room's timeline. It owns all sync decisions and
 * touches the player only through the adapter, so it runs under test with a
 * fake player and clock.
 */
export class SyncController {
  private playback: Playback | null = null;
  private lastActionAt = -Infinity;
  private lastSeekAt = -Infinity;
  private lastTime = 0;
  private lastTickAt = 0;
  private stalledTicks = 0;
  private startTimer: number | null = null;
  private nudgeTimer: number | null = null;
  private nudging = false;

  constructor(
    private readonly player: PlayerAdapter,
    private readonly clock: Clock,
    private readonly emit: (command: LocalCommand) => void,
    private readonly report: (report: SyncReport) => void,
    private readonly timers: Timers = browserTimers,
  ) {
    player.onState((state) => this.handlePlayerState(state));
  }

  /** Applies the room's latest playback. */
  apply(playback: Playback): void {
    const previous = this.playback;
    this.playback = playback;
    this.cancelNudge();
    this.clearStart();

    if (playback.status === 'paused') {
      this.act(() => {
        this.player.pause();
        if (Math.abs(this.player.time() - playback.pos) > DRIFT_OK_S) this.player.seek(playback.pos);
      });
      return;
    }
    if (playback.status !== 'playing') return;

    const now = this.clock.now();
    if (now < playback.at) {
      this.holdUntilStart(playback, now);
      return;
    }

    const expected = expectedPosition(playback, now);
    const jumped = Math.abs(this.player.time() - expected) > NUDGE_BEHIND_MAX_S;
    const sameTimeline = previous?.item === playback.item && previous.status === 'playing';
    this.act(() => {
      if (jumped || !sameTimeline) {
        if (Math.abs(this.player.time() - expected) > DRIFT_OK_S) this.seekTo(expected);
      }
      this.player.setRate(playback.rate);
      this.player.play();
    });
  }

  private holdUntilStart(playback: Playback, now: number): void {
    this.act(() => {
      this.player.pause();
      if (Math.abs(this.player.time() - playback.pos) > DRIFT_OK_S) this.player.seek(playback.pos);
    });
    this.startTimer = this.timers.setTimeout(() => {
      this.startTimer = null;
      this.act(() => {
        this.player.setRate(playback.rate);
        this.player.play();
      });
    }, playback.at - now);
    this.report({ health: 'waiting', drift: 0 });
  }

  /** Runs once a second while mounted. */
  tick(): void {
    const playback = this.playback;
    if (!playback) return;
    const now = this.clock.now();

    if (playback.status === 'paused') {
      this.detectPausedSeek(playback, now);
      return;
    }
    if (playback.status !== 'playing' || now < playback.at) return;

    const state = this.player.state();
    const time = this.player.time();
    const expected = expectedPosition(playback, now);
    const drift = time - expected;

    if (state === 'buffering' || state === 'loading') {
      this.report({ health: 'buffering', drift });
      this.remember(time, now);
      return;
    }

    if (this.isStalled(state, time)) {
      // Most likely an ad. It is never skipped; the room carries on and this
      // viewer catches up afterwards.
      this.report({ health: 'stalled', drift });
      this.remember(time, now);
      return;
    }

    if (state === 'paused' && !this.recentlyActed(now)) {
      this.act(() => this.player.play());
    }

    this.detectUserSeek(playback, time, now, expected);
    this.correct(drift, expected, now);
    this.remember(time, now);
  }

  private isStalled(state: PlayerState, time: number): boolean {
    if (state !== 'playing' || Math.abs(time - this.lastTime) > 0.05) {
      this.stalledTicks = 0;
      return false;
    }
    this.stalledTicks += 1;
    return this.stalledTicks >= STALL_TICKS;
  }

  private remember(time: number, now: number): void {
    this.lastTime = time;
    this.lastTickAt = now;
  }

  /** The native player controls stay on, so a viewer's seek shows as a jump. */
  private detectUserSeek(playback: Playback, time: number, now: number, expected: number): void {
    if (this.recentlyActed(now) || this.nudging || this.lastTickAt === 0) return;
    const elapsed = ((now - this.lastTickAt) / 1000) * playback.rate;
    const jump = time - (this.lastTime + elapsed);
    if (Math.abs(jump) > USER_SEEK_THRESHOLD_S && Math.abs(time - expected) > USER_SEEK_THRESHOLD_S) {
      this.emit({ type: 'seek', pos: time, ct: now });
      this.lastActionAt = now;
    }
  }

  private detectPausedSeek(playback: Playback, now: number): void {
    const time = this.player.time();
    if (!this.recentlyActed(now) && Math.abs(time - playback.pos) > USER_SEEK_THRESHOLD_S) {
      this.lastActionAt = now;
      this.emit({ type: 'seek', pos: time, ct: now });
    }
  }

  private correct(drift: number, expected: number, now: number): void {
    const size = Math.abs(drift);
    if (size < DRIFT_OK_S) {
      this.report({ health: 'synced', drift });
      return;
    }
    this.report({ health: 'correcting', drift });
    if (this.nudging || this.recentlyActed(now)) return;

    const ahead = drift > 0;
    if (size > (ahead ? NUDGE_AHEAD_MAX_S : NUDGE_BEHIND_MAX_S)) {
      if (now - this.lastSeekAt >= SEEK_COOLDOWN_MS) this.act(() => this.seekTo(expected));
      return;
    }

    if (this.player.rates.kind === 'fine') {
      const rate = this.playback?.rate ?? 1;
      this.nudgeRate(rate + (ahead ? -FINE_RATE_DELTA : FINE_RATE_DELTA), size / FINE_RATE_DELTA);
    } else if (ahead) {
      this.nudgePause(size);
    } else {
      this.nudgeRate(CATCH_UP_RATE, size / (CATCH_UP_RATE - 1));
    }
  }

  private nudgeRate(rate: number, seconds: number): void {
    this.nudging = true;
    this.player.setRate(rate);
    this.nudgeTimer = this.timers.setTimeout(() => {
      this.nudging = false;
      this.player.setRate(this.playback?.rate ?? 1);
    }, seconds * 1000);
  }

  private nudgePause(seconds: number): void {
    this.nudging = true;
    this.markAction();
    this.player.pause();
    this.nudgeTimer = this.timers.setTimeout(() => {
      this.nudging = false;
      this.act(() => this.player.play());
    }, seconds * 1000);
  }

  private cancelNudge(): void {
    if (this.nudgeTimer !== null) this.timers.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
    if (this.nudging) this.player.setRate(this.playback?.rate ?? 1);
    this.nudging = false;
  }

  private clearStart(): void {
    if (this.startTimer !== null) this.timers.clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private seekTo(expected: number): void {
    this.lastSeekAt = this.clock.now();
    this.player.seek(expected + SEEK_SETTLE_S);
  }

  private act(work: () => void): void {
    this.markAction();
    work();
  }

  private markAction(): void {
    this.lastActionAt = this.clock.now();
  }

  private recentlyActed(now: number): boolean {
    return now - this.lastActionAt < ECHO_WINDOW_MS;
  }

  /** Turns the viewer's own use of the native controls into room commands. */
  private handlePlayerState(state: PlayerState): void {
    const playback = this.playback;
    if (!playback) return;
    const now = this.clock.now();

    if (state === 'ended') {
      this.emit({ type: 'ended' });
      return;
    }
    if (this.nudging || now < playback.at) return;

    if (state === 'paused' && playback.status === 'playing' && !this.recentlyActed(now)) {
      this.lastActionAt = now;
      this.emit({ type: 'pause', pos: this.player.time(), ct: now });
    } else if (
      state === 'playing' &&
      playback.status === 'paused' &&
      now - this.lastActionAt >= RESUME_ECHO_WINDOW_MS
    ) {
      this.lastActionAt = now;
      this.emit({ type: 'play', pos: this.player.time(), ct: now });
    }
  }

  destroy(): void {
    this.cancelNudge();
    this.clearStart();
  }
}
