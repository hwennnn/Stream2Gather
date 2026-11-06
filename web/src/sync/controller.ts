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
/**
 * How long a player we just moved, or a viewer's command the room has not
 * answered, is left alone before being corrected. It only ever delays a
 * correction: what the viewer does is told from an echo by `expecting`.
 */
const SETTLE_MS = 1500;
const USER_SEEK_THRESHOLD_S = 1;
/** A jump to within this of where we last sent the player is that seek landing. */
const OWN_SEEK_WINDOW_S = 2;
/** Beyond this, a throttled tab makes the time between ticks meaningless. */
const MAX_TICK_GAP_MS = 2500;
const STALL_TICKS = 3;

const samePlayback = (a: Playback, b: Playback): boolean =>
  a.item === b.item && a.status === b.status && a.pos === b.pos && a.at === b.at && a.rate === b.rate;

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
  private settleFrom = -Infinity;
  private lastSeekAt = -Infinity;
  private lastTime = 0;
  private lastTickAt = 0;
  private lastState: PlayerState | null = null;
  /** Where we sent the player, until it is seen arriving. Seeks can land late. */
  private pendingSeek: number | null = null;
  /**
   * What we last told the player to do, until it says it has. Set only by our
   * own pause() and play(), and only when the player will report a change.
   */
  private expecting: 'paused' | 'playing' | null = null;
  /** What this viewer last told the room, until the room answers. */
  private asked: 'paused' | 'playing' | null = null;
  private stalledTicks = 0;
  /** The player has been seen resting on the room's paused position. */
  private settled = false;
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

  /**
   * Applies the room's latest playback. Most events repeat it, such as a queue
   * add or a lock toggle, and those leave the player alone. A resync is the room
   * insisting, as when it refused a command, so it always goes through.
   */
  apply(playback: Playback, resync = false): void {
    const previous = this.playback;
    if (!resync && previous && samePlayback(previous, playback)) return;
    this.playback = playback;
    this.asked = null;
    this.settled &&= previous?.item === playback.item && previous.pos === playback.pos;
    this.cancelNudge();
    this.clearStart();

    if (playback.status === 'paused') {
      this.act(() => {
        this.pausePlayer();
        if (Math.abs(this.player.time() - playback.pos) > DRIFT_OK_S) this.seekPlayer(playback.pos);
      });
      this.noteSettled(playback);
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
      this.playPlayer();
    });
  }

  private holdUntilStart(playback: Playback, now: number): void {
    this.act(() => {
      this.pausePlayer();
      if (Math.abs(this.player.time() - playback.pos) > DRIFT_OK_S) this.seekPlayer(playback.pos);
    });
    this.startTimer = this.timers.setTimeout(() => {
      this.startTimer = null;
      this.act(() => {
        this.player.setRate(playback.rate);
        this.playPlayer();
      });
    }, playback.at - now);
    this.report({ health: 'waiting', drift: 0 });
  }

  /** Runs once a second while mounted. */
  tick(): void {
    const playback = this.playback;
    if (!playback) return;
    const now = this.clock.now();

    const state = this.player.state();
    const time = this.player.time();
    // Some commands change nothing the player would report, so no echo comes.
    if (state === this.expecting) this.expecting = null;
    const landed = this.noteLanding(time);

    if (playback.status === 'paused') {
      // Either the room refused this viewer's play, or it never heard about it.
      if (state === 'playing' && !this.settling(now)) this.act(() => this.pausePlayer());
      this.detectPausedSeek(playback, state, time, now);
      this.remember(time, now, state);
      return;
    }
    if (playback.status !== 'playing' || now < playback.at) return;

    const expected = expectedPosition(playback, now);
    const drift = time - expected;

    if (state === 'buffering' || state === 'loading') {
      this.report({ health: 'buffering', drift });
      this.remember(time, now, state);
      return;
    }

    if (this.isStalled(state, time)) {
      // Most likely an ad. It is never skipped; the room carries on and this
      // viewer catches up afterwards.
      this.report({ health: 'stalled', drift });
      this.remember(time, now, state);
      return;
    }

    if (state === 'paused' && !this.nudging && !this.settling(now)) {
      this.act(() => this.playPlayer());
    }

    if (!landed) this.detectUserSeek(playback, state, time, now, expected);
    this.correct(drift, expected, now);
    this.remember(time, now, state);
  }

  private isStalled(state: PlayerState, time: number): boolean {
    if (state !== 'playing' || Math.abs(time - this.lastTime) > 0.05) {
      this.stalledTicks = 0;
      return false;
    }
    this.stalledTicks += 1;
    return this.stalledTicks >= STALL_TICKS;
  }

  /** Reports whether our own seek has just arrived, so the jump is not the viewer's. */
  private noteLanding(time: number): boolean {
    if (this.pendingSeek === null || Math.abs(time - this.pendingSeek) > OWN_SEEK_WINDOW_S) return false;
    this.pendingSeek = null;
    return true;
  }

  private remember(time: number, now: number, state: PlayerState): void {
    this.lastTime = time;
    this.lastTickAt = now;
    this.lastState = state;
  }

  /**
   * The native player controls stay on, so a viewer's seek shows as a jump. It
   * moves the whole room, so anything else must not pass for one: a player that
   * was not running across both ticks, one that froze (its time did not move, it
   * only fell behind the clock), or a tab the browser put to sleep between ticks.
   */
  private detectUserSeek(
    playback: Playback,
    state: PlayerState,
    time: number,
    now: number,
    expected: number,
  ): void {
    if (state !== 'playing' || this.lastState !== 'playing') return;
    if (now - this.lastTickAt > MAX_TICK_GAP_MS) return;
    if (Math.abs(time - this.lastTime) <= USER_SEEK_THRESHOLD_S) return;

    const elapsed = ((now - this.lastTickAt) / 1000) * playback.rate;
    const jump = time - (this.lastTime + elapsed);
    if (Math.abs(jump) > USER_SEEK_THRESHOLD_S && Math.abs(time - expected) > USER_SEEK_THRESHOLD_S) {
      this.pendingSeek = null;
      this.markAction();
      this.emit({ type: 'seek', pos: time, ct: now });
    }
  }

  /**
   * A paused player only counts once it has been seen on the room's position.
   * Until then, being elsewhere means it has not arrived, like a joiner's player
   * still reporting 0, and that must not drag the room back with it. Being off
   * position is a lasting condition, so waiting to settle delays a viewer's seek
   * by a tick at most and cannot lose it.
   */
  private detectPausedSeek(playback: Playback, state: PlayerState, time: number, now: number): void {
    if (state !== 'paused' || this.noteSettled(playback)) return;
    if (this.settling(now)) return;
    if (this.settled) {
      this.markAction();
      this.emit({ type: 'seek', pos: time, ct: now });
    } else {
      this.act(() => this.seekPlayer(playback.pos));
    }
  }

  /** Reports whether the player is resting on the room's paused position. */
  private noteSettled(playback: Playback): boolean {
    const resting =
      this.player.state() === 'paused' &&
      Math.abs(this.player.time() - playback.pos) <= USER_SEEK_THRESHOLD_S;
    this.settled ||= resting;
    return resting;
  }

  private correct(drift: number, expected: number, now: number): void {
    const size = Math.abs(drift);
    if (size < DRIFT_OK_S) {
      this.report({ health: 'synced', drift });
      return;
    }
    this.report({ health: 'correcting', drift });
    if (this.nudging || this.settling(now)) return;

    const ahead = drift > 0;
    if (size > (ahead ? NUDGE_AHEAD_MAX_S : NUDGE_BEHIND_MAX_S)) {
      if (now - this.lastSeekAt >= SEEK_COOLDOWN_MS) this.act(() => this.seekTo(expected));
      return;
    }

    if (this.player.rates === 'fine') {
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
    this.act(() => this.pausePlayer());
    this.nudgeTimer = this.timers.setTimeout(() => {
      this.nudging = false;
      this.act(() => this.playPlayer());
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
    this.seekPlayer(expected + SEEK_SETTLE_S);
  }

  private seekPlayer(seconds: number): void {
    this.pendingSeek = seconds;
    this.player.seek(seconds);
  }

  /** A paused player that is told to pause again says nothing, so nothing is expected. */
  private pausePlayer(): void {
    if (this.player.state() !== 'paused' || this.expecting) this.expecting = 'paused';
    this.player.pause();
  }

  /** So does a running one told to play, buffering included. */
  private playPlayer(): void {
    const state = this.player.state();
    if (state === 'paused' || state === 'ready' || this.expecting) this.expecting = 'playing';
    this.player.play();
  }

  /** Moving the player puts it back on the room's view, so nothing is outstanding. */
  private act(work: () => void): void {
    this.asked = null;
    this.markAction();
    work();
  }

  private markAction(): void {
    this.settleFrom = this.clock.now();
  }

  private settling(now: number): boolean {
    return now - this.settleFrom < SETTLE_MS;
  }

  /**
   * Turns the viewer's own use of the native controls into room commands. While
   * an echo is due, the opposite report is older news: a pause landing behind our
   * play, or a player that was already starting when we paused it.
   */
  private handlePlayerState(state: PlayerState): void {
    const playback = this.playback;
    if (!playback) return;

    if (state === 'ended') {
      this.emit({ type: 'ended' });
      return;
    }
    if (state === 'buffering' && this.expecting === 'playing') {
      this.expecting = null; // It has left paused, so a pause from here is the viewer's.
      return;
    }
    if (state !== 'paused' && state !== 'playing') return;
    if (this.expecting) {
      if (this.expecting === state) this.expecting = null;
      return;
    }

    const now = this.clock.now();
    if (now < playback.at) return;
    // Until the room answers, its status is older than what this viewer just did.
    const status = this.asked ?? playback.status;
    if (state === 'paused' && status === 'playing') {
      this.tellRoom('paused', { type: 'pause', pos: this.player.time(), ct: now });
    } else if (state === 'playing' && status === 'paused') {
      this.tellRoom('playing', { type: 'play', pos: this.player.time(), ct: now });
    }
  }

  private tellRoom(asked: 'paused' | 'playing', command: LocalCommand): void {
    this.asked = asked;
    this.markAction();
    this.emit(command);
  }

  destroy(): void {
    this.cancelNudge();
    this.clearStart();
  }
}
