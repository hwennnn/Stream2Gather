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
  onRefused: (refused: boolean) => void = () => {},
): (() => void) => {
  let timer = 0;
  let waited = 0;
  let stopped = false;
  let told = false;
  let tried = false;
  // With sound, asking again only helps a viewer who made a gesture. A muted start can go unheard, so it's always asked twice.
  let asked = !navigator.userActivation?.hasBeenActive;
  const startMuted = () => {
    if (stopped || !roomPlaying() || (tried && player.muted())) return;
    tried = true;
    asked = false;
    player.setMuted(true);
    player.play();
    onMuted(true);
  };
  const look = () => {
    const state = player.state();
    // It was allowed. A pause from here is the viewer's, even before the room hears of it.
    if (state === 'playing') {
      onRefused(false);
      return;
    }
    // A hidden tab holds every player back, and nothing can be learned until it's seen.
    waited = document.hidden ? 0 : waited + LOOK_EVERY_MS;
    if (waited >= AUTOPLAY_CHECK_MS) {
      waited = 0;
      const playing = roomPlaying();
      if (!playing && !told) return;
      const unstarted = player.unstarted?.() ?? false;
      if (playing && (refused(state) || unstarted) && !stoppedOnPurpose()) {
        if (unstarted && !asked) {
          asked = true;
          player.play();
        } else if (tried && player.muted()) {
          // Still as well as muted, so only the viewer can start it.
          told = true;
          onRefused(true);
        } else {
          startMuted();
        }
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
