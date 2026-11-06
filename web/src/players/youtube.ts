import { createBlockedChannel, createErrorChannel, type PlayerAdapter, type PlayerError, type PlayerState } from './types';

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_TIMEOUT_MS = 15_000;

let apiReady: Promise<void> | null = null;

const requestApi = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    const giveUp = (message: string) => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error(message));
    };
    const timer = window.setTimeout(() => giveUp('The YouTube player took too long to load.'), API_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => giveUp('The YouTube player could not be loaded.');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  });

/** A failure is not kept, so the next video gets a fresh attempt. */
export const loadApi = (): Promise<void> => {
  apiReady ??= requestApi().catch((error: unknown) => {
    apiReady = null;
    throw error;
  });
  return apiReady;
};

const STATE_NAMES: Record<number, PlayerState> = {
  [-1]: 'loading',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'ready',
};

const toError = (code: number): PlayerError => {
  if (code === 101 || code === 150) return { kind: 'embed_blocked', code };
  if (code === 2 || code === 100) return { kind: 'unavailable', code };
  return { kind: 'unknown', code };
};

/**
 * Wraps YouTube's official player, unmodified and with its controls on, as
 * YouTube's terms require. Nothing may be drawn over it.
 */
export const createYouTubePlayer = async (
  element: HTMLElement,
  videoId: string,
  startAt: number,
  autoplay: boolean,
): Promise<PlayerAdapter> => {
  await loadApi();

  let state: PlayerState = 'loading';
  let stateListener: (state: PlayerState) => void = () => {};
  const errors = createErrorChannel();
  const blocked = createBlockedChannel();

  const target = document.createElement('div');
  element.replaceChildren(target);

  const player = await new Promise<YT.Player>((resolve) => {
    const instance: YT.Player = new YT.Player(target, {
      width: '100%',
      height: '100%',
      videoId,
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: autoplay ? 1 : 0,
        playsinline: 1,
        rel: 0,
        start: Math.floor(startAt),
        origin: window.location.origin,
      },
      events: {
        onReady: () => resolve(instance),
        onStateChange: (event) => {
          state = STATE_NAMES[event.data] ?? state;
          stateListener(state);
        },
        onAutoplayBlocked: blocked.report,
        onError: (event) => {
          // Before onReady the promise must still settle, and the error waits
          // in the channel for the caller to subscribe.
          errors.report(toError(Number(event.data)));
          resolve(instance);
        },
      },
    } as YT.PlayerOptions);
  });

  return {
    rates: 'discrete',
    play: () => player.playVideo?.(),
    pause: () => player.pauseVideo?.(),
    seek: (seconds) => player.seekTo?.(seconds, true),
    cue: (seconds) => player.cueVideoById?.(videoId, seconds),
    setRate: (rate) => player.setPlaybackRate?.(rate),
    time: () => player.getCurrentTime?.() ?? 0,
    state: () => state,
    setMuted: (muted) => (muted ? player.mute?.() : player.unMute?.()),
    muted: () => player.isMuted?.() ?? false,
    duration: () => player.getDuration?.() || null,
    setVolume: (volume) => player.setVolume?.(Math.round(volume * 100)),
    volume: () => {
      const level = player.getVolume?.();
      return level === undefined ? null : level / 100;
    },
    onState: (listener) => {
      stateListener = listener;
    },
    onError: errors.listen,
    onBlocked: blocked.listen,
    destroy: () => {
      player.destroy?.();
      element.replaceChildren();
    },
  };
};
