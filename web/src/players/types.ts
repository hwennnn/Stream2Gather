export type PlayerState = 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended';

export type PlayerErrorKind = 'unavailable' | 'embed_blocked' | 'network' | 'unknown';

export type PlayerError = { kind: PlayerErrorKind; code: number };

export type PlayerRates =
  | { kind: 'fine'; min: number; max: number }
  | { kind: 'discrete'; values: number[] };

/** The only surface sync logic sees, so every source behaves the same to it. */
export interface PlayerAdapter {
  readonly rates: PlayerRates;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  time(): number;
  state(): PlayerState;
  setMuted(muted: boolean): void;
  muted(): boolean;
  onState(listener: (state: PlayerState) => void): void;
  onError(listener: (error: PlayerError) => void): void;
  destroy(): void;
}
