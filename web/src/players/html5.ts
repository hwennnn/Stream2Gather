import { createBlockedChannel, createErrorChannel, type PlayerAdapter, type PlayerError, type PlayerState } from './types';

/**
 * A host that doesn't allow other sites fails with no status at all, which is the
 * only sign a browser gives. Offline looks the same, so that is ruled out first.
 */
export const hlsError = (network: boolean, status: number, online: boolean): PlayerError => {
  if (!network) return { kind: 'unavailable', code: status };
  return { kind: status === 0 && online ? 'embed_blocked' : 'network', code: status };
};

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
  const blocked = createBlockedChannel();
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
      errors.report(hlsError(data.type === Hls.ErrorTypes.NETWORK_ERROR, data.response?.code ?? 0, navigator.onLine));
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
      // A pause that interrupts a play also rejects, and means nothing.
      void video.play().catch((error: unknown) => {
        if (error instanceof Error && error.name === 'NotAllowedError') blocked.report();
      });
    },
    pause: () => video.pause(),
    seek: (seconds) => {
      video.currentTime = seconds;
    },
    cue: (seconds) => {
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
    setVolume: (volume) => {
      video.volume = volume;
    },
    volume: () => video.volume,
    duration: () => (Number.isFinite(video.duration) ? video.duration : null),
    onState: (listener) => {
      stateListener = listener;
    },
    onError: errors.listen,
    onBlocked: blocked.listen,
    destroy: () => {
      destroyHls();
      video.removeAttribute('src');
      video.load();
      element.replaceChildren();
    },
  };
};
