export type PlayerState = 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended';

export type PlayerErrorKind = 'unavailable' | 'embed_blocked' | 'ip_origin' | 'no_referrer' | 'network' | 'unknown';

export type PlayerError = { kind: PlayerErrorKind; code: number };

/** 'fine' takes any playback rate; 'discrete' only the steps YouTube offers; 'none' can't change rate. */
export type PlayerRates = 'fine' | 'discrete' | 'none';

/** A player in these states has shown nothing yet, and a seek would start it. */
export const notStarted = (state: PlayerState): boolean => state === 'loading' || state === 'ready';

/** The only surface sync logic sees, so every source behaves the same to it. */
export interface PlayerAdapter {
  readonly rates: PlayerRates;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** Shows the video at this position without starting it, for a player that hasn't started. */
  cue(seconds: number): void;
  setRate(rate: number): void;
  time(): number;
  /** In seconds, or null until the player knows. */
  duration(): number | null;
  state(): PlayerState;
  setMuted(muted: boolean): void;
  muted(): boolean;
  /** Takes 0 to 1. Does nothing where the browser keeps volume to itself, as on iPhone. */
  setVolume(volume: number): void;
  /** From 0 to 1, or null if the player can't say. */
  volume(): number | null;
  onState(listener: (state: PlayerState) => void): void;
  onError(listener: (error: PlayerError) => void): void;
  /** The browser refused to start it, which is the only sure sign of an autoplay block. */
  /** Told to start and hasn't. A browser's refusal can look like this without ever saying so. */
  unstarted?(): boolean;
  onBlocked(listener: () => void): void;
  destroy(): void;
}

/** Holds on to a refusal made before anyone is listening, as `createErrorChannel` does. */
export const createBlockedChannel = () => {
  let listener: (() => void) | null = null;
  let early = false;
  return {
    report: () => {
      if (listener) listener();
      else early = true;
    },
    listen: (next: () => void) => {
      listener = next;
      if (early) next();
      early = false;
    },
  };
};

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
