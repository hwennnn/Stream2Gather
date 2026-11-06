import { api } from '../api/http';
import { createClock, loadApi, stamp, tooSmallNotice, type Embed } from './twitchEmbed';
import { createBlockedChannel, createErrorChannel, type PlayerAdapter, type PlayerState } from './types';

/** The smallest size Twitch's embed terms allow. Below it the embed comes off the page. */
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
/** The embed's own time only moves about once a second, too coarse to sync on. */
const TIME_POLL_MS = 200;
/**
 * Measured on the real embed: with nobody near it, it pauses itself and carries on
 * 9 ms later. Passed on at once, that would pause the whole room for everyone.
 */
const PAUSE_SETTLE_MS = 1500;

/**
 * Wraps Twitch's own player, with nothing drawn over it. It has no playback rate.
 * A live channel has no shared position, so its time is only the room's clock,
 * which leaves sync with nothing to correct while play and pause still work.
 */
export const createTwitchPlayer = async (
  element: HTMLElement,
  sourceId: string,
  url: string,
  startAt: number,
  autoplay: boolean,
): Promise<PlayerAdapter> => {
  const [twitch, config] = await Promise.all([loadApi(), api.config()]);
  const [kind, name = ''] = sourceId.split(':');
  const live = kind === 'channel';

  let state: PlayerState = 'loading';
  let stateListener: (state: PlayerState) => void = () => {};
  const errors = createErrorChannel();
  const blocked = createBlockedChannel();
  const set = (next: PlayerState) => {
    state = next;
    stateListener(next);
  };

  const clock = createClock(startAt);
  if (autoplay) clock.run();
  // On the page, and past READY, before which Twitch's player can't be called.
  let mounted: Embed | null = null;
  let embed: Embed | null = null;
  // It won't start from script unless it was muted from the moment it loaded, and
  // nothing called afterwards helps. The room offers to unmute, as for any video.
  let silent = true;
  let settled = () => {};
  const settle = new Promise<void>((resolve) => {
    settled = resolve;
  });

  let pausing = 0;
  let askedToPause = false;
  const stop = () => {
    askedToPause = false;
    clock.stop();
    set('paused');
  };

  const mount = () => {
    const target = document.createElement('div');
    target.className = 'h-full w-full';
    element.replaceChildren(target);
    const running = state === 'playing' || (state === 'loading' && autoplay);
    const instance = new twitch.Player(target, {
      width: '100%',
      height: '100%',
      parent: [config.twitchParent],
      autoplay: running,
      muted: silent,
      ...(live ? { channel: name } : { video: name, time: stamp(clock.now()) }),
    });
    mounted = instance;
    const on = (event: string | undefined, work: () => void) => {
      if (event) instance.addEventListener(event, () => mounted === instance && work());
    };
    on(twitch.Player.READY, () => {
      embed = instance;
      if (state === 'loading') set('ready');
      settled();
    });
    // A channel found offline can't be played. One going offline has finished.
    on(twitch.Player.OFFLINE, () => {
      if (state === 'loading') errors.report({ kind: 'unavailable', code: 0 });
      else set('ended');
      settled();
    });
    on(twitch.Player.PLAYING, () => {
      window.clearTimeout(pausing);
      clock.run();
      reportedAt = performance.now();
      set('playing');
    });
    on(twitch.Player.PAUSE, () => {
      if (askedToPause) {
        stop();
        return;
      }
      if (state === 'playing') set('buffering');
      window.clearTimeout(pausing);
      pausing = window.setTimeout(() => embed?.isPaused() && stop(), PAUSE_SETTLE_MS);
    });
    on(twitch.Player.ENDED, () => set('ended'));
    on(twitch.Player.PLAYBACK_BLOCKED, blocked.report);
  };

  const unmount = () => {
    if (embed && !live) clock.set(shown);
    mounted?.destroy?.();
    mounted = null;
    embed = null;
    element.replaceChildren(tooSmallNotice(url));
    settled();
  };

  // Where the embed last said it was, and when that changed. Only time spent
  // playing counts, and time read between two changes must not go backwards.
  let reported = startAt;
  let reportedAt = performance.now();
  let shown = startAt;
  const moveTo = (seconds: number) => {
    reported = seconds;
    reportedAt = performance.now();
    shown = seconds;
  };
  const poll = window.setInterval(() => {
    if (!embed || live) return;
    const seconds = embed.getCurrentTime();
    if (seconds === reported) return;
    if (Math.abs(seconds - shown) > 2) moveTo(seconds);
    else {
      reported = seconds;
      reportedAt = performance.now();
    }
  }, TIME_POLL_MS);

  const fits = () => element.clientWidth >= MIN_WIDTH && element.clientHeight >= MIN_HEIGHT;
  const fit = () => {
    if (fits() && !mounted) mount();
    else if (!fits() && (mounted || element.childElementCount === 0)) unmount();
  };
  const resize = new ResizeObserver(fit);
  resize.observe(element);
  fit();
  await settle;

  const seek = (seconds: number) => {
    clock.set(seconds);
    moveTo(seconds);
    if (!live) embed?.seek(seconds);
  };

  return {
    rates: 'none',
    play: () => {
      askedToPause = false;
      clock.run();
      if (embed) embed.play();
      else set('playing');
    },
    pause: () => {
      clock.stop();
      askedToPause = embed !== null;
      if (embed) embed.pause();
      else set('paused');
    },
    seek,
    cue: seek,
    setRate: () => {},
    time: () => {
      if (!embed || live) return clock.now();
      if (state === 'playing') shown = Math.max(shown, reported + (performance.now() - reportedAt) / 1000);
      return shown;
    },
    duration: () => (live ? null : embed?.getDuration() || null),
    state: () => state,
    setMuted: (muted) => {
      silent = muted;
      embed?.setMuted(muted);
    },
    muted: () => embed?.getMuted() ?? silent,
    setVolume: (volume) => embed?.setVolume(volume),
    volume: () => embed?.getVolume() ?? null,
    onState: (listener) => {
      stateListener = listener;
    },
    onError: errors.listen,
    onBlocked: blocked.listen,
    destroy: () => {
      resize.disconnect();
      window.clearInterval(poll);
      window.clearTimeout(pausing);
      mounted?.destroy?.();
      mounted = null;
      embed = null;
      element.replaceChildren();
    },
  };
};
