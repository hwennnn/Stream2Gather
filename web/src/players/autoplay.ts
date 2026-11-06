import type { PlayerAdapter, PlayerState } from './types';

const AUTOPLAY_CHECK_MS = 2500;
/** Often enough to see a player start before a viewer could pause it. */
const LOOK_EVERY_MS = 250;

/** A player sitting still was refused. One still loading hasn't been asked yet. */
const refused = (state: PlayerState): boolean => state === 'paused' || state === 'ready';

/**
 * Browsers can refuse sound without a gesture. Muted is better than stuck. The
 * player says when that happens. Looking at it afterwards is the fallback for a
 * browser that doesn't, and must not take a stop someone meant for a refusal.
 */
export const watchAutoplay = (
  roomPlaying: () => boolean,
  stoppedOnPurpose: () => boolean,
  player: PlayerAdapter,
  onMuted: (muted: boolean) => void,
): (() => void) => {
  let timer = 0;
  let waited = 0;
  let stopped = false;
  const startMuted = () => {
    if (stopped || !roomPlaying() || player.muted()) return;
    player.setMuted(true);
    player.play();
    onMuted(true);
  };
  const look = () => {
    const state = player.state();
    // It was allowed. A pause from here is the viewer's, even before the room hears of it.
    if (state === 'playing') return;
    waited += LOOK_EVERY_MS;
    if (waited >= AUTOPLAY_CHECK_MS) {
      waited = 0;
      if (!roomPlaying()) return;
      if (refused(state) && !stoppedOnPurpose()) {
        startMuted();
        return;
      }
    }
    timer = window.setTimeout(look, LOOK_EVERY_MS);
  };
  player.onBlocked(startMuted);
  timer = window.setTimeout(look, LOOK_EVERY_MS);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
};
