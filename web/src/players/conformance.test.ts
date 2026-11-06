import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHtml5Player } from './html5';
import { createTwitchPlayer } from './twitch';
import type { PlayerAdapter, PlayerState } from './types';
import { createVimeoPlayer } from './vimeo';
import { createYouTubePlayer } from './youtube';

/** What each source's fake must offer, so one set of rules can be run against them all. */
type Harness = {
  player: PlayerAdapter;
  /** The SDK calls made so far, as "name" or "name:value". */
  calls: string[];
  /** The SDK reports that it has reached this state. */
  become: (state: 'playing' | 'paused' | 'ended') => void;
  /** The SDK reports this position, as it does while playing. */
  at: (seconds: number) => void;
};

/** The name a DOM video, Vimeo and Twitch all nearly give each of these. */
const EVENT_NAMES = { playing: 'playing', paused: 'pause', ended: 'ended' };

const element = () => ({ replaceChildren: vi.fn() }) as unknown as HTMLElement & { replaceChildren: ReturnType<typeof vi.fn> };

const vimeo = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock('@vimeo/player', () => ({
  default: function FakeVimeo() {
    return vimeo.current;
  },
}));

const mountVimeo = async (host: HTMLElement): Promise<Harness> => {
  const calls: string[] = [];
  const handlers = new Map<string, (data: never) => void>();
  const call = (name: string) => (value?: unknown) => {
    calls.push(value === undefined ? name : `${name}:${value}`);
    return Promise.resolve();
  };
  vimeo.current = {
    on: (event: string, handler: (data: never) => void) => handlers.set(event, handler),
    ready: () => Promise.resolve(),
    getVolume: () => Promise.resolve(1),
    getMuted: () => Promise.resolve(false),
    play: call('play'),
    pause: call('pause'),
    setCurrentTime: call('seek'),
    setPlaybackRate: call('rate'),
    setVolume: call('volume'),
    setMuted: call('muted'),
    destroy: call('destroy'),
  };
  vi.stubGlobal('document', { createElement: () => ({}) });
  const player = await createVimeoPlayer(host, '123', 0, false);
  const fire = (event: string, data: unknown) => handlers.get(event)?.(data as never);
  return {
    player,
    calls,
    become: (state) => fire(EVENT_NAMES[state], { percent: 0.5, seconds: 0 }),
    at: (seconds) => fire('timeupdate', { seconds }),
  };
};

vi.mock('../api/http', () => ({ api: { config: () => Promise.resolve({ twitchParent: 'localhost' }) } }));

const twitch = { calls: [] as string[], handlers: new Map<string, () => void>(), seconds: 0, level: 1 };

/** The loader keeps the first API it gets, so every mount shares this one class. */
class FakeTwitch {
  static READY = 'ready';
  static PLAYING = 'playing';
  static PAUSE = 'pause';
  static ENDED = 'ended';
  addEventListener = (event: string, listener: () => void) => twitch.handlers.set(event, listener);
  play = () => twitch.calls.push('play');
  pause = () => twitch.calls.push('pause');
  seek = (seconds: number) => twitch.calls.push(`seek:${seconds}`);
  isPaused = () => true;
  getCurrentTime = () => twitch.seconds;
  getDuration = () => 600;
  getMuted = () => true;
  setMuted = () => {};
  getVolume = () => twitch.level;
  setVolume = (level: number) => {
    twitch.calls.push(`volume:${level}`);
    twitch.level = level;
  };
  destroy = () => twitch.calls.push('destroy');
}

const mountTwitch = async (host: HTMLElement): Promise<Harness> => {
  Object.assign(twitch, { calls: [], handlers: new Map(), seconds: 0, level: 1 });
  Object.assign(host, { clientWidth: 800, clientHeight: 450, childElementCount: 0 });
  vi.stubGlobal('window', { Twitch: { Player: FakeTwitch }, setInterval, clearInterval, setTimeout, clearTimeout });
  vi.stubGlobal('document', { createElement: () => ({}) });
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
  const pending = createTwitchPlayer(host, 'video:42', '', 0, false);
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  twitch.handlers.get('ready')?.();
  return {
    player: await pending,
    calls: twitch.calls,
    become: (state) => {
      twitch.handlers.get(EVENT_NAMES[state])?.();
      // A pause only counts once it has lasted.
      vi.advanceTimersByTime(1500);
    },
    at: (seconds) => {
      twitch.seconds = seconds;
    },
  };
};

class FakeVideo extends EventTarget {
  ended = false;
  paused = true;
  time = 0;
  level = 1;
  constructor(readonly calls: string[]) {
    super();
  }
  canPlayType = () => '';
  load = () => void this.calls.push('destroy');
  removeAttribute = () => {};
  play = async () => void this.calls.push('play');
  pause = () => void this.calls.push('pause');
  get currentTime() {
    return this.time;
  }
  set currentTime(seconds: number) {
    this.time = seconds;
    this.calls.push(`seek:${seconds}`);
  }
  get volume() {
    return this.level;
  }
  set volume(level: number) {
    this.level = level;
    this.calls.push(`volume:${level}`);
  }
  set playbackRate(rate: number) {
    this.calls.push(`rate:${rate}`);
  }
}

const mountHtml5 = async (host: HTMLElement): Promise<Harness> => {
  const calls: string[] = [];
  const video = new FakeVideo(calls);
  vi.stubGlobal('document', { createElement: () => video });
  vi.stubGlobal('window', { location: { href: 'http://test/' } });
  const player = await createHtml5Player(host, 'http://test/a.mp4', 0);
  return {
    player,
    calls,
    become: (state) => video.dispatchEvent(new Event(EVENT_NAMES[state])),
    at: (seconds) => {
      video.time = seconds;
    },
  };
};

const mountYouTube = async (host: HTMLElement): Promise<Harness> => {
  const calls: string[] = [];
  let time = 0;
  let level = 100;
  let onStateChange: (event: { data: number }) => void = () => {};
  const call = (name: string) => (value?: unknown) => void calls.push(value === undefined ? name : `${name}:${value}`);
  class FakePlayer {
    playVideo = call('play');
    pauseVideo = call('pause');
    seekTo = (seconds: number) => {
      time = seconds;
      calls.push(`seek:${seconds}`);
    };
    setPlaybackRate = call('rate');
    getCurrentTime = () => time;
    setVolume = (volume: number) => {
      level = volume;
      calls.push(`volume:${volume / 100}`);
    };
    getVolume = () => level;
    destroy = call('destroy');
    constructor(_target: unknown, options: { events: { onReady: () => void; onStateChange: typeof onStateChange } }) {
      onStateChange = options.events.onStateChange;
      queueMicrotask(options.events.onReady);
    }
  }
  vi.stubGlobal('YT', { Player: FakePlayer });
  vi.stubGlobal('window', { YT: { Player: FakePlayer }, location: { origin: 'http://test' } });
  vi.stubGlobal('document', { createElement: () => ({}) });
  const player = await createYouTubePlayer(host, 'abc', 0, false);
  const codes: Record<string, number> = { playing: 1, paused: 2, ended: 0 };
  return {
    player,
    calls,
    become: (state) => onStateChange({ data: codes[state] ?? -1 }),
    at: (seconds) => {
      time = seconds;
    },
  };
};

const SOURCES: [string, (host: HTMLElement) => Promise<Harness>][] = [
  ['html5', mountHtml5],
  ['youtube', mountYouTube],
  ['vimeo', mountVimeo],
  ['twitch', mountTwitch],
];

describe.each(SOURCES)('%s meets the adapter contract', (_name, mount) => {
  let host: ReturnType<typeof element>;
  let harness: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    host = element();
    harness = await mount(host);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('passes play and pause to the SDK', () => {
    harness.player.play();
    harness.player.pause();
    expect(harness.calls).toEqual(expect.arrayContaining(['play', 'pause']));
  });

  it.each<PlayerState & ('playing' | 'paused' | 'ended')>(['playing', 'paused', 'ended'])('reports %s', (state) => {
    const seen: PlayerState[] = [];
    harness.player.onState((next) => seen.push(next));
    harness.become(state);
    expect(seen).toEqual([state]);
    expect(harness.player.state()).toBe(state);
  });

  it('seeks, and says so straight away', () => {
    harness.player.seek(42);
    expect(harness.calls).toContain('seek:42');
    expect(harness.player.time()).toBeCloseTo(42, 0);
  });

  it('answers time() at once, and never goes backwards while playing', () => {
    harness.become('playing');
    expect(typeof harness.player.time()).toBe('number');
    for (let tick = 1; tick <= 40; tick += 1) {
      vi.advanceTimersByTime(100);
      const before = harness.player.time();
      // Reports land late, as they do from a player in another frame.
      if (tick % 3 === 0) harness.at(tick / 10 - 0.08);
      expect(harness.player.time()).toBeGreaterThanOrEqual(before);
    }
  });

  it('gives a length, or null until it knows', () => {
    const length = harness.player.duration();
    expect(length === null || length > 0).toBe(true);
  });

  it('passes volume to the SDK and reads it back', () => {
    harness.player.setVolume(0.3);
    expect(harness.calls).toContain('volume:0.3');
    expect(harness.player.volume()).toBeCloseTo(0.3);
  });

  it('honours its own rates', () => {
    harness.player.setRate(1.05);
    const reached = harness.calls.includes('rate:1.05');
    expect(reached).toBe(harness.player.rates !== 'none');
  });

  it('leaves nothing behind when destroyed', () => {
    host.replaceChildren.mockClear();
    harness.player.destroy();
    expect(host.replaceChildren).toHaveBeenCalledWith();
    expect(harness.calls).toContain('destroy');
  });
});
