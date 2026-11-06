import type { PlayerAdapter } from '../players/types';

/** How far a voice pulls the video down, relative to the viewer's own level. */
const DUCKED = 0.3;
const STEPS = 5;
const STEP_MS = 30;
const HOLD_MS = 600;
/** Players round what they're given, so only a real difference is the viewer's hand. */
const TOLERANCE = 0.02;

type Options = {
  player: () => PlayerAdapter | null;
  /** Asked each time someone starts talking, as the answer depends on the video. */
  enabled: () => boolean;
};

/**
 * Lowers the video while someone else talks. It starts from the viewer's level,
 * leaves a muted player alone and gives up the moment the viewer touches the volume.
 */
export class Ducker {
  private owner: PlayerAdapter | null = null;
  /** The viewer's own level, for as long as the video is lowered. */
  private level: number | null = null;
  /** YouTube reports a new volume late, so the last two writes both count as ours. */
  private written: number[] = [];
  private ramp: ReturnType<typeof setInterval> | null = null;
  private hold: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: Options) {}

  speaking(on: boolean): void {
    if (!on) {
      if (this.level !== null && this.hold === null) {
        this.hold = setTimeout(() => this.rise(), HOLD_MS);
      }
      return;
    }
    this.clearHold();
    if (this.level !== null) {
      if (this.touched()) this.forget();
      else this.moveTo(this.level * DUCKED);
      return;
    }
    const player = this.options.player();
    const level = player?.volume() ?? null;
    if (!player || level === null || player.muted() || !this.options.enabled()) return;
    this.owner = player;
    this.level = level;
    this.written = [level];
    this.moveTo(level * DUCKED);
  }

  /** Puts the viewer's level back at once. For leaving the call or turning this off. */
  stop(): void {
    const level = this.level;
    const touched = this.touched();
    const player = this.owner;
    this.forget();
    if (level !== null && !touched) player?.setVolume(level);
  }

  private rise(): void {
    this.hold = null;
    if (this.level !== null) this.moveTo(this.level, () => this.forget());
  }

  private moveTo(target: number, done?: () => void): void {
    this.clearRamp();
    const from = this.written.at(-1) ?? target;
    // Voices come and go while the video is already down, so often there's nothing to do.
    if (from === target) {
      done?.();
      return;
    }
    let step = 0;
    this.ramp = setInterval(() => {
      if (this.touched()) {
        this.forget();
        return;
      }
      step += 1;
      const volume = step === STEPS ? target : from + ((target - from) * step) / STEPS;
      this.owner?.setVolume(volume);
      this.written = [...this.written.slice(-1), volume];
      if (step === STEPS) {
        this.clearRamp();
        done?.();
      }
    }, STEP_MS);
  }

  /** The viewer moved the volume, or the video changed under us. */
  private touched(): boolean {
    if (this.level === null) return false;
    if (this.owner !== this.options.player()) return true;
    const volume = this.owner?.volume() ?? null;
    return volume !== null && !this.written.some((value) => Math.abs(value - volume) <= TOLERANCE);
  }

  private forget(): void {
    this.clearRamp();
    this.clearHold();
    this.level = null;
    this.owner = null;
    this.written = [];
  }

  private clearRamp(): void {
    if (this.ramp !== null) clearInterval(this.ramp);
    this.ramp = null;
  }

  private clearHold(): void {
    if (this.hold !== null) clearTimeout(this.hold);
    this.hold = null;
  }
}
