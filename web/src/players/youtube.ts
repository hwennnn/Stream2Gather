import type { PlayerAdapter, PlayerError, PlayerRates, PlayerState } from './types';

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<void> | null = null;

const loadApi = (): Promise<void> => {
  apiReady ??= new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
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
): Promise<PlayerAdapter> => {
  await loadApi();

  let state: PlayerState = 'loading';
  let stateListener: (state: PlayerState) => void = () => {};
  let errorListener: (error: PlayerError) => void = () => {};

  const target = document.createElement('div');
  element.replaceChildren(target);

  const player = await new Promise<YT.Player>((resolve) => {
    const instance: YT.Player = new YT.Player(target, {
      width: '100%',
      height: '100%',
      videoId,
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 1,
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
        onError: (event) => {
          // Before onReady the promise must still settle for callers to see it.
          resolve(instance);
          errorListener(toError(Number(event.data)));
        },
      },
    } as YT.PlayerOptions);
  });

  const rates: PlayerRates = { kind: 'discrete', values: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] };

  return {
    rates,
    play: () => player.playVideo?.(),
    pause: () => player.pauseVideo?.(),
    seek: (seconds) => player.seekTo?.(seconds, true),
    setRate: (rate) => player.setPlaybackRate?.(rate),
    time: () => player.getCurrentTime?.() ?? 0,
    state: () => state,
    setMuted: (muted) => (muted ? player.mute?.() : player.unMute?.()),
    muted: () => player.isMuted?.() ?? false,
    onState: (listener) => {
      stateListener = listener;
    },
    onError: (listener) => {
      errorListener = listener;
    },
    destroy: () => {
      player.destroy?.();
      element.replaceChildren();
    },
  };
};
