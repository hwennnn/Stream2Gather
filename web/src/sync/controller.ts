import { notStarted, type PlayerAdapter, type PlayerState } from '../players/types';

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

type Page = Pick<Document, 'hidden' | 'pictureInPictureElement'>;

/** Nobody can reach a player they can't see. A picture-in-picture window stays in reach of a hidden tab. */
export const outOfReach = (page: Page): boolean => page.hidden && !page.pictureInPictureElement;

/** Below this, viewers cannot perceive the gap and correcting only adds risk. */
export const DRIFT_OK_S = 0.15;
/** Every correction a player without rate control makes is a visible jump, so it allows more. */
const SEEK_ONLY_OK_S = 1.5;
/** Up to this a correction is the app's business. Beyond it, "In sync" would be untrue. */
const IN_SYNC_S = 0.4;
const NUDGE_AHEAD_MAX_S = 2;
const NUDGE_BEHIND_MAX_S = 3;
const CATCH_UP_RATE = 1.25;
const FINE_RATE_DELTA = 0.05;
/**
 * How far past the room a seek aims, to land on it once it has taken its time.
 * A file seeks at once. YouTube rebuffers. It then learns from where seeks land.
 */
const SEEK_LEAD_S = { fine: 0.05, discrete: 0.25, none: 0.25 };
const SEEK_LEAD_MAX_S = 1.5;
/** Between corrective seeks, so a slow connection doesn't seek forever. A room's command doesn't count. */
const SEEK_COOLDOWN_MS = 10_000;
/** A player back from buffering has already stopped, so a jump costs nothing a nudge would save. */
const STALL_SEEK_S = 0.4;
/** YouTube can only nudge at 1.25x, which takes four times the gap, so past this it jumps. */
const JUMP_BEHIND_S = 1;
/** A jump that lasted this long worked, so the next stall is a new problem, not the same one. */
const SEEK_HELD_MS = 3000;
/** A seek stops this far short of the end. YouTube can restart a video sent past it. */
const END_MARGIN_S = 1;
/** A report of the end can be lost or come early, so it is repeated until the room moves on. */
const ENDED_RETRY_MS = 2000;
/**
 * How long a player we just moved, or a viewer's command the room has not
 * answered, is left alone before being corrected. It only ever delays a
 * correction: what the viewer does is told from an echo by `expecting`.
 */
const SETTLE_MS = 1500;
const USER_SEEK_THRESHOLD_S = 1;
/** Buffering can skip a small gap in the video, so a jump across it must be bigger. */
const USER_SEEK_BUFFERED_S = 3;
/** A jump to within this of where we last sent the player is that seek landing. */
const OWN_SEEK_WINDOW_S = 2;
/**
 * How long a pause waits before it goes to the room. A double-click pauses and
 * plays, and a click on the timeline pauses, seeks and plays. Neither is a pause.
 */
const PAUSE_HOLD_MS = 300;
/** Dragging the timeline keeps the player paused. It is over once it rests this long. */
const SCRUB_REST_MS = 1000;
const SCRUB_MOVED_S = 0.5;
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
 * How long ago a moment was. The clock runs on the computer's own time until the
 * first ping answers, so a moment from then can sit ahead of now, by as much as
 * the computer is wrong. That says nothing about how long ago it was, and treating
 * it as just now would hold off every correction until the clock caught up.
 */
const since = (moment: number, now: number): number => (moment > now ? Infinity : now - moment);

/**
 * Keeps one player on the room's timeline. It owns all sync decisions and
 * touches the player only through the adapter, so it runs under test with a
 * fake player and clock.
 */
export class SyncController {
  private playback: Playback | null = null;
  private settleFrom = -Infinity;
  private lastSeekAt = -Infinity;
  private learnedLead: number | null = null;
  /** A corrective seek made while running, whose landing says how far off the lead was. */
  private measuringSeek = false;
  private onRoomSince: number | null = null;
  private retriedJump = false;
  private finished = false;
  private endedAt = -Infinity;
  private lastTickAt = 0;
  /**
   * Where the player last was at a tick, running or resting on the room's paused
   * position. It can only have moved on from here at its own speed, so anything
   * else is a jump. Buffering leaves it alone: a seek that passes through
   * buffering is still measured from where the player left.
   */
  private anchor: { time: number; at: number } | null = null;
  /** The player has not run since it last buffered, or at all. */
  private wasBuffering = true;
  /** Where we sent the player, until it is seen arriving. Seeks can land late. */
  private pendingSeek: number | null = null;
  /**
   * What we last told the player to do, until it says it has. Set only by our
   * own pause() and play(), and only when the player will report a change.
   */
  private expecting: 'paused' | 'playing' | null = null;
  /** What this viewer last told the room, until the room answers. */
  private asked: 'paused' | 'playing' | null = null;
  /** A pause the viewer made that the room has not been told about yet. */
  private held: { timer: number; time: number } | null = null;
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
    private readonly unseen: () => boolean = () => outOfReach(document),
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
    const repeat = previous !== null && samePlayback(previous, playback);
    if (!resync && repeat) return;
    this.playback = playback;
    if (!repeat) this.finished = false;
    if (this.finished) return; // Only the room moving on, or going back, changes anything now.
    this.asked = null;
    this.measuringSeek = false;
    if (this.held && playback.status === 'playing') {
      // Someone else moved the room first. This viewer's pause still stands.
      this.endHold();
      if (this.held || this.asked) return;
    }
    this.dropHold();
    this.settled &&= previous?.item === playback.item && previous.pos === playback.pos;
    this.cancelNudge();
    this.clearStart();

    if (playback.status === 'paused') {
      this.act(() => {
        if (notStarted(this.player.state())) {
          this.player.cue(playback.pos);
          return;
        }
        this.pausePlayer();
        if (Math.abs(this.player.time() - playback.pos) > DRIFT_OK_S) this.seekPlayer(playback.pos);
      });
      this.noteSettled(playback);
      // Ticks report nothing here, so without this a viewer's last word stands for the whole pause.
      this.report({ health: 'waiting', drift: 0 });
      return;
    }
    if (playback.status !== 'playing') return;

    const now = this.clock.now();
    if (now < playback.at) {
      this.holdUntilStart(playback, now);
      return;
    }

    const expected = expectedPosition(playback, now);
    const off = this.player.time() - expected;
    const jumped = Math.abs(off) > NUDGE_BEHIND_MAX_S;
    // A new timeline is a command: everyone goes there now, however short the move.
    this.act(() => {
      if (jumped || !repeat) {
        if (Math.abs(this.player.time() - expected) > DRIFT_OK_S) this.seekTo(expected);
      }
      this.player.setRate(playback.rate);
      this.playPlayer();
    });
    if (Math.abs(off) >= IN_SYNC_S) this.reportDrift(off);
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

  /** The player is stopped because the viewer or a correction stopped it, not the browser. */
  stoppedOnPurpose(): boolean {
    return this.held !== null || this.nudging || this.asked === 'paused';
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
      this.lastTickAt = now;
      if (state === 'paused' && this.settled) this.remember(time, now);
      return;
    }
    if (playback.status !== 'playing' || now < playback.at) return;

    const expected = expectedPosition(playback, now);
    const drift = time - expected;

    if (this.finished || this.pastTheEnd(expected)) {
      this.reportDrift(drift);
      this.reportEnded(now);
      return;
    }

    if (state === 'buffering' || state === 'loading') {
      this.report({ health: 'buffering', drift });
      this.lastTickAt = now;
      this.wasBuffering = true;
      return;
    }

    if (this.isStalled(state, time)) {
      // Most likely an ad. It is never skipped; the room carries on and this
      // viewer catches up afterwards.
      this.report({ health: 'stalled', drift });
      this.remember(time, now);
      return;
    }

    if (state === 'paused' && !this.nudging && !this.settling(now)) {
      this.act(() => this.playPlayer());
    }

    if (!landed && state === 'playing') this.detectUserSeek(playback, time, now, expected);
    if (state === 'playing') this.learnSeekLead(drift);
    this.correct(drift, expected, now);
    if (state === 'playing') this.remember(time, now);
    else this.lastTickAt = now;
  }

  private isStalled(state: PlayerState, time: number): boolean {
    if (state !== 'playing' || !this.anchor || Math.abs(time - this.anchor.time) > 0.05) {
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
    // Measured from the old spot, this seek would read as the viewer's once buffering ends.
    this.anchor = { time, at: this.clock.now() };
    return true;
  }

  private remember(time: number, now: number): void {
    this.lastTickAt = now;
    this.anchor = { time, at: now };
    this.wasBuffering = false;
  }

  /**
   * The native player controls stay on, so a viewer's seek shows as a jump. It
   * moves the whole room, so anything else must not pass for one: a player never
   * seen running, one that froze or buffered (it only fell behind the clock), or
   * a tab the browser put to sleep between ticks.
   */
  private detectUserSeek(playback: Playback, time: number, now: number, expected: number): void {
    if (!this.jumped(playback, time, now) || Math.abs(time - expected) <= USER_SEEK_THRESHOLD_S) return;
    this.pendingSeek = null;
    this.measuringSeek = false;
    this.markAction();
    this.emit({ type: 'seek', pos: time, ct: now });
    this.remember(time, now);
  }

  private jumped(playback: Playback, time: number, now: number): boolean {
    if (!this.anchor || now - this.lastTickAt > MAX_TICK_GAP_MS) return false;
    const elapsed = ((now - this.anchor.at) / 1000) * playback.rate;
    const margin = this.wasBuffering ? USER_SEEK_BUFFERED_S : USER_SEEK_THRESHOLD_S;
    return time < this.anchor.time - margin || time > this.anchor.time + elapsed + margin;
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
    this.noteHeld(size, now);
    this.reportDrift(drift);
    const seekOnly = this.player.rates === 'none';
    if (size < (seekOnly ? SEEK_ONLY_OK_S : DRIFT_OK_S)) return;
    const ahead = drift > 0;
    const mayJump = !this.settling(now) && since(this.lastSeekAt, now) >= SEEK_COOLDOWN_MS;
    if (this.wasBuffering && !ahead && size >= STALL_SEEK_S && mayJump) {
      this.cancelNudge();
      this.jumpToRoom(expected, now);
      return;
    }
    if (this.nudging || this.settling(now)) return;
    if (seekOnly) {
      if (mayJump) this.jumpToRoom(expected, now);
      return;
    }

    const nudgeMax = ahead ? NUDGE_AHEAD_MAX_S : NUDGE_BEHIND_MAX_S;
    const jumpFrom = !ahead && this.player.rates === 'discrete' ? JUMP_BEHIND_S : nudgeMax;
    if (size > jumpFrom && mayJump) {
      this.jumpToRoom(expected, now);
      return;
    }
    if (size > nudgeMax) return;

    if (this.player.rates === 'fine') {
      const rate = this.playback?.rate ?? 1;
      this.nudgeRate(rate + (ahead ? -FINE_RATE_DELTA : FINE_RATE_DELTA), size / FINE_RATE_DELTA);
    } else if (ahead) {
      this.nudgePause(size);
    } else {
      this.nudgeRate(CATCH_UP_RATE, size / (CATCH_UP_RATE - 1));
    }
  }

  private noteHeld(size: number, now: number): void {
    if (size >= DRIFT_OK_S) {
      this.onRoomSince = null;
      return;
    }
    this.onRoomSince ??= now;
    if (now - this.onRoomSince < SEEK_HELD_MS) return;
    this.lastSeekAt = -Infinity;
    this.retriedJump = false;
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

  /** Only a running player on the room's position is in sync, however close a stopped one is. */
  private reportDrift(drift: number): void {
    const state = this.player.state();
    if (state === 'buffering' || state === 'loading') this.report({ health: 'buffering', drift });
    else {
      const limit = this.player.rates === 'none' ? SEEK_ONLY_OK_S : IN_SYNC_S;
      this.report({ health: state === 'playing' && Math.abs(drift) < limit ? 'synced' : 'correcting', drift });
    }
  }

  private jumpToRoom(expected: number, now: number): void {
    this.lastSeekAt = now;
    this.measuringSeek = this.player.state() === 'playing';
    this.act(() => this.seekTo(expected));
  }

  private seekTo(expected: number): void {
    const target = expected + this.seekLead();
    const length = this.player.duration();
    this.seekPlayer(length === null ? target : Math.min(target, length - END_MARGIN_S));
  }

  private pastTheEnd(expected: number): boolean {
    const length = this.player.duration();
    return length !== null && expected >= length;
  }

  private reportEnded(now: number): void {
    if (now - this.endedAt < ENDED_RETRY_MS) return;
    this.endedAt = now;
    this.emit({ type: 'ended' });
  }

  private seekLead(): number {
    return this.learnedLead ?? SEEK_LEAD_S[this.player.rates];
  }

  /** Landing behind means the seek took longer than the lead allowed, and ahead the reverse. */
  private learnSeekLead(drift: number): void {
    if (!this.measuringSeek || this.pendingSeek !== null) return;
    this.measuringSeek = false;
    this.learnedLead = Math.min(SEEK_LEAD_MAX_S, Math.max(0, this.seekLead() - drift));
    // It fell short for want of that lead, so it gets one more go with it.
    if (drift <= -STALL_SEEK_S && !this.retriedJump) {
      this.retriedJump = true;
      this.lastSeekAt = -Infinity;
    }
  }

  private seekPlayer(seconds: number): void {
    this.pendingSeek = seconds;
    this.player.seek(seconds);
  }

  /** Only a running player answers a pause. Waiting on any other would swallow the viewer's next click. */
  private pausePlayer(): void {
    const state = this.player.state();
    if (state === 'playing' || state === 'buffering' || this.expecting) this.expecting = 'paused';
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
    return this.held !== null || since(this.settleFrom, now) < SETTLE_MS;
  }

  private holdPause(time: number, ms: number): void {
    this.dropHold();
    this.held = { time, timer: this.timers.setTimeout(() => this.endHold(), ms) };
  }

  private dropHold(): void {
    if (this.held) this.timers.clearTimeout(this.held.timer);
    this.held = null;
  }

  /** The player kept going, so the viewer never paused. Otherwise the room needs to know. */
  private endHold(): void {
    const from = this.held?.time;
    this.dropHold();
    if (from === undefined || this.player.state() !== 'paused') return;
    const time = this.player.time();
    if (Math.abs(time - from) > SCRUB_MOVED_S) {
      this.holdPause(time, SCRUB_REST_MS);
      return;
    }
    this.tellRoom('paused', { type: 'pause', pos: time, ct: this.clock.now() });
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
      this.finished = true;
      this.reportEnded(this.clock.now());
      return;
    }
    if (this.finished) return; // Whatever it does now, nobody asked for it.
    if (state === 'buffering' || state === 'loading') this.wasBuffering = true;
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
    const time = this.player.time();
    // Until the room answers, its status is older than what this viewer just did.
    const status = this.asked ?? playback.status;
    if (state === 'paused' && status === 'playing') {
      // The browser stops a player as its tab goes out of sight. Only this viewer's player
      // stopped, and `tick` starts it again, so the room must not stop with it.
      if (this.unseen()) return;
      this.markAction();
      this.reportDrift(time - expectedPosition(playback, now));
      // A pause that lands away from the player is the timeline being grabbed.
      this.holdPause(time, this.jumped(playback, time, now) ? SCRUB_REST_MS : PAUSE_HOLD_MS);
    } else if (state === 'playing' && status === 'paused') {
      this.tellRoom('playing', { type: 'play', pos: time, ct: now });
    } else if (state === 'playing') {
      this.dropHold();
      const expected = expectedPosition(playback, now);
      if (!this.noteLanding(time)) this.detectUserSeek(playback, time, now, expected);
      if (this.wasBuffering) this.correct(time - expected, expected, now);
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
    this.dropHold();
  }
}
