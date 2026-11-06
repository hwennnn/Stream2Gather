import Player from '@vimeo/player';
import { createBlockedChannel, createErrorChannel, type PlayerAdapter, type PlayerError, type PlayerRates, type PlayerState } from './types';

const toError = (name = ''): PlayerError => ({
  kind: name === 'PrivacyError' || name === 'PasswordError' ? 'embed_blocked' : 'unavailable',
  code: 0,
});

/** The source ID is "id" or "id:hash", and an unlisted video needs its hash to open. */
const embedUrl = (sourceId: string, startAt: number, autoplay: boolean): string => {
  const [id, hash] = sourceId.split(':');
  const params = new URLSearchParams({ autoplay: autoplay ? '1' : '0', dnt: '1', playsinline: '1' });
  if (hash) params.set('h', hash);
  return `https://player.vimeo.com/video/${id}?${params}#t=${Math.floor(startAt)}s`;
};

/**
 * Wraps Vimeo's own player, with its controls on and nothing drawn over it. Every
 * read from it is async, so time and volume are kept from its events. Given an
 * iframe rather than an ID, the SDK has no need to call oEmbed from the browser.
 */
export const createVimeoPlayer = async (
  element: HTMLElement,
  sourceId: string,
  startAt: number,
  autoplay: boolean,
): Promise<PlayerAdapter> => {
  const frame = document.createElement('iframe');
  frame.src = embedUrl(sourceId, startAt, autoplay);
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.title = 'Vimeo player';
  frame.className = 'h-full w-full';
  element.replaceChildren(frame);
  const player = new Player(frame);

  let state: PlayerState = 'loading';
  let stateListener: (state: PlayerState) => void = () => {};
  const errors = createErrorChannel();
  const blocked = createBlockedChannel();
  const set = (next: PlayerState) => {
    state = next;
    stateListener(next);
  };

  let rates: PlayerRates = 'fine';
  let rate = 1;
  let level: number | null = null;
  let silent = false;

  // Where the player last said it was, and when: timeupdate comes about every 250 ms.
  // Time read in between must never go backwards, and only time spent playing counts.
  let seen = startAt;
  let seenAt = performance.now();
  let shown = startAt;
  let length: number | null = null;
  const moveTo = (seconds: number) => {
    seen = seconds;
    seenAt = performance.now();
    shown = seconds;
  };
  const noteTime = (seconds: number) => {
    if (Math.abs(seconds - shown) > 1) {
      moveTo(seconds);
      return;
    }
    seen = seconds;
    seenAt = performance.now();
  };

  const resume = (seconds: number) => {
    moveTo(seconds);
    set('playing');
  };

  // Vimeo says nothing while it loads or seeks. Until the latest seek lands, the
  // player is buffering, and any position it reports is from before that seek.
  let seeks = 0;
  let seeking = false;
  const seek = (seconds: number) => {
    moveTo(seconds);
    seeks += 1;
    const mine = seeks;
    seeking = true;
    if (state === 'playing') set('buffering');
    const landed = () => {
      if (mine !== seeks) return;
      seeking = false;
      if (state === 'buffering') resume(seen);
    };
    player.setCurrentTime(seconds).then(landed, landed);
  };

  player.on('timeupdate', ({ seconds, duration }) => {
    length = duration || length;
    if (!seeking) noteTime(seconds);
  });
  player.on('seeked', ({ seconds }) => {
    if (!seeking) moveTo(seconds);
  });
  player.on('playing', ({ seconds }) => {
    if (!seeking) resume(seconds);
  });
  // A video pauses itself on reaching its end, just before 'ended'. Nobody pressed anything.
  player.on('pause', ({ percent }) => {
    if (percent < 1) set('paused');
  });
  player.on('ended', () => set('ended'));
  player.on('bufferstart', () => state === 'playing' && set('buffering'));
  player.on('bufferend', () => {
    if (state === 'buffering' && !seeking) resume(seen);
  });
  player.on('volumechange', ({ volume }) => {
    level = volume;
  });
  player.on('playbackratechange', ({ playbackRate }) => {
    rate = playbackRate;
  });

  await new Promise<void>((resolve) => {
    // An error from a call names its method. Without one, the video itself failed.
    player.on('error', ({ name, method }) => {
      if (method) return;
      errors.report(toError(name));
      resolve();
    });
    player.ready().then(resolve, (error: Error) => {
      errors.report(toError(error.name));
      resolve();
    });
  });
  if (state === 'loading') state = 'ready';
  void player.getVolume().then((volume) => {
    level ??= volume;
  }, () => {});
  void player.getMuted().then((muted) => {
    silent = muted;
  }, () => {});

  return {
    get rates() {
      return rates;
    },
    play: () => {
      if (state === 'ready') set('buffering');
      void player.play().catch((error: unknown) => {
        if (state === 'buffering') set('ready');
        if (error instanceof Error && error.name === 'NotAllowedError') blocked.report();
      });
    },
    pause: () => {
      void player.pause().catch(() => {});
    },
    seek,
    cue: seek,
    // Speed depends on the plan of whoever uploaded the video, so the only way to
    // find out is to try. A refusal makes this player correct by seeking instead.
    setRate: (next) => {
      if (rates === 'none' || next === rate) return;
      player.setPlaybackRate(next).then(
        () => {
          rate = next;
        },
        () => {
          rates = 'none';
        },
      );
    },
    time: () => {
      if (state === 'playing') shown = Math.max(shown, seen + ((performance.now() - seenAt) / 1000) * rate);
      return shown;
    },
    duration: () => length,
    state: () => state,
    setMuted: (muted) => {
      silent = muted;
      void player.setMuted(muted).catch(() => {});
    },
    muted: () => silent,
    setVolume: (volume) => {
      level = volume;
      void player.setVolume(volume).catch(() => {});
    },
    volume: () => level,
    onState: (listener) => {
      stateListener = listener;
    },
    onError: errors.listen,
    onBlocked: blocked.listen,
    destroy: () => {
      void player.destroy().catch(() => {});
      element.replaceChildren();
    },
  };
};
