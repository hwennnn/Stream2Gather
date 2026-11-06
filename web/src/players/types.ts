export type PlayerState = 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended';

export type PlayerErrorKind = 'unavailable' | 'embed_blocked' | 'network' | 'unknown';

export type PlayerError = { kind: PlayerErrorKind; code: number };

/** 'fine' takes any playback rate; 'discrete' only the steps YouTube offers. */
export type PlayerRates = 'fine' | 'discrete';

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

/**
 * Holds on to an error raised before anyone is listening. A player can fail
 * while it is still being created, and the caller only subscribes afterwards.
 */
export const createErrorChannel = () => {
  let listener: ((error: PlayerError) => void) | null = null;
  let early: PlayerError | null = null;
  return {
    report: (error: PlayerError) => {
      if (listener) listener(error);
      else early = error;
    },
    listen: (next: (error: PlayerError) => void) => {
      listener = next;
      if (early) next(early);
      early = null;
    },
  };
};
