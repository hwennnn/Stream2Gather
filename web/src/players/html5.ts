import type { PlayerAdapter, PlayerError, PlayerState } from './types';

/** Plays a media file directly, which gives the tightest sync of any source. */
export const createHtml5Player = async (
  element: HTMLElement,
  url: string,
  startAt: number,
): Promise<PlayerAdapter> => {
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.className = 'h-full w-full bg-black';
  element.replaceChildren(video);

  let destroyHls = () => {};
  if (new URL(url, window.location.href).pathname.endsWith('.m3u8') && !video.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: Hls } = await import('hls.js');
    const hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
    destroyHls = () => hls.destroy();
  } else {
    video.src = url;
  }
  video.currentTime = startAt;

  let state: PlayerState = 'loading';
  let stateListener: (state: PlayerState) => void = () => {};
  let errorListener: (error: PlayerError) => void = () => {};
  const set = (next: PlayerState) => {
    state = next;
    stateListener(next);
  };

  video.addEventListener('canplay', () => state === 'loading' && set('ready'));
  video.addEventListener('playing', () => set('playing'));
  video.addEventListener('pause', () => set('paused'));
  video.addEventListener('waiting', () => set('buffering'));
  video.addEventListener('ended', () => set('ended'));
  video.addEventListener('error', () =>
    errorListener({ kind: 'unavailable', code: video.error?.code ?? 0 }),
  );

  return {
    rates: { kind: 'fine', min: 0.5, max: 2 },
    play: () => {
      void video.play().catch(() => {});
    },
    pause: () => video.pause(),
    seek: (seconds) => {
      video.currentTime = seconds;
    },
    setRate: (rate) => {
      video.playbackRate = rate;
    },
    time: () => video.currentTime,
    state: () => state,
    setMuted: (muted) => {
      video.muted = muted;
    },
    muted: () => video.muted,
    onState: (listener) => {
      stateListener = listener;
    },
    onError: (listener) => {
      errorListener = listener;
    },
    destroy: () => {
      destroyHls();
      video.removeAttribute('src');
      video.load();
      element.replaceChildren();
    },
  };
};
