import { createErrorChannel, type PlayerAdapter, type PlayerState } from './types';

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

  let state: PlayerState = 'loading';
  let stateListener: (state: PlayerState) => void = () => {};
  const errors = createErrorChannel();
  const set = (next: PlayerState) => {
    state = next;
    stateListener(next);
  };

  let destroyHls = () => {};
  if (new URL(url, window.location.href).pathname.endsWith('.m3u8') && !video.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: Hls } = await import('hls.js');
    const hls = new Hls();
    let recovered = false;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // hls.js can rebuild a broken decoder once. Nothing brings back a dead stream.
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true;
        hls.recoverMediaError();
        return;
      }
      const kind = data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'unavailable';
      errors.report({ kind, code: data.response?.code ?? 0 });
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    destroyHls = () => hls.destroy();
  } else {
    video.src = url;
  }
  video.currentTime = startAt;

  video.addEventListener('canplay', () => state === 'loading' && set('ready'));
  video.addEventListener('playing', () => set('playing'));
  // A video pauses itself on reaching its end, just before 'ended'. Nobody pressed anything.
  video.addEventListener('pause', () => {
    if (!video.ended) set('paused');
  });
  video.addEventListener('waiting', () => set('buffering'));
  video.addEventListener('ended', () => set('ended'));
  video.addEventListener('error', () =>
    errors.report({ kind: 'unavailable', code: video.error?.code ?? 0 }),
  );

  return {
    rates: 'fine',
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
    // A video told to pause before it ever played fires no pause event.
    state: () => (state === 'ready' && video.paused ? 'paused' : state),
    setMuted: (muted) => {
      video.muted = muted;
    },
    muted: () => video.muted,
    onState: (listener) => {
      stateListener = listener;
    },
    onError: errors.listen,
    destroy: () => {
      destroyHls();
      video.removeAttribute('src');
      video.load();
      element.replaceChildren();
    },
  };
};
