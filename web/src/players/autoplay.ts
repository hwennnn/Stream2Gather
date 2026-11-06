import type { PlayerAdapter, PlayerState } from './types';

const AUTOPLAY_CHECK_MS = 2500;

/** A player sitting still was refused. One still loading hasn't been asked yet. */
const refused = (state: PlayerState): boolean => state === 'paused' || state === 'ready';
const undecided = (state: PlayerState): boolean => state === 'loading' || state === 'buffering';

/** Browsers can refuse sound without a gesture. Muted is better than stuck. */
export const watchAutoplay = (
  roomPlaying: () => boolean,
  player: PlayerAdapter,
  onMuted: (muted: boolean) => void,
): (() => void) => {
  let timer = 0;
  const check = () => {
    if (!roomPlaying()) return;
    const state = player.state();
    if (undecided(state)) {
      timer = window.setTimeout(check, AUTOPLAY_CHECK_MS);
    } else if (refused(state)) {
      player.setMuted(true);
      player.play();
      onMuted(true);
    }
  };
  timer = window.setTimeout(check, AUTOPLAY_CHECK_MS);
  return () => window.clearTimeout(timer);
};
