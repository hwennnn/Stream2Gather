import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createErrorChannel, type PlayerError } from './types';
import { createYouTubePlayer, loadApi, toError } from './youtube';

type FakeScript = { src: string; onerror: (() => void) | null; remove: () => void };

describe('loadApi', () => {
  let scripts: FakeScript[];
  let fakeWindow: { YT?: unknown; onYouTubeIframeAPIReady?: () => void } & Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    scripts = [];
    fakeWindow = { setTimeout, clearTimeout, location: { origin: 'http://test' } };
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', {
      createElement: () => {
        const script: FakeScript = { src: '', onerror: null, remove: vi.fn() };
        scripts.push(script);
        return script;
      },
      head: { append: () => {} },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // This goes first because the loader remembers a success, as it should.
  it('rejects when the script never answers', async () => {
    const outcome = expect(loadApi()).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(16_000);
    await outcome;
  });

  it('rejects when the script is blocked, then tries again next time', async () => {
    const first = loadApi();
    scripts[0]?.onerror?.();
    await expect(first).rejects.toThrow('could not be loaded');

    const second = loadApi();
    expect(scripts).toHaveLength(2);
    fakeWindow.onYouTubeIframeAPIReady?.();
    await expect(second).resolves.toBeUndefined();
  });
});

describe('toError', () => {
  it('trusts a refusal on a named site', () => {
    expect(toError(150, 'watch.example.com')).toEqual({ kind: 'embed_blocked', code: 150 });
    expect(toError(101, 'localhost')).toEqual({ kind: 'embed_blocked', code: 101 });
  });

  // YouTube gives the same code for the page's address as for an owner's block.
  it('blames the address when the page has no name', () => {
    expect(toError(150, '192.168.1.20')).toEqual({ kind: 'ip_origin', code: 150 });
    expect(toError(101, '[::1]')).toEqual({ kind: 'ip_origin', code: 101 });
  });

  it('keeps a missing referrer apart from a refusal', () => {
    expect(toError(153, 'localhost')).toEqual({ kind: 'no_referrer', code: 153 });
  });

  it('says a removed video is gone, and leaves a player fault unknown', () => {
    expect(toError(100, 'localhost').kind).toBe('unavailable');
    expect(toError(2, 'localhost').kind).toBe('unavailable');
    expect(toError(5, 'localhost').kind).toBe('unknown');
  });
});

describe('an error raised before ready', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reaches a listener that subscribes afterwards', async () => {
    type Events = { onError: (event: { data: number }) => void };
    class FakePlayer {
      constructor(_target: unknown, options: { events: Events }) {
        queueMicrotask(() => options.events.onError({ data: 150 }));
      }
    }
    const YT = { Player: FakePlayer };
    vi.stubGlobal('YT', YT);
    vi.stubGlobal('window', { YT, location: { origin: 'http://test', hostname: 'test' } });
    vi.stubGlobal('document', { createElement: () => ({}) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const player = await createYouTubePlayer({ replaceChildren: () => {} } as unknown as HTMLElement, 'abc', 0, true);
    const seen: PlayerError[] = [];
    player.onError((error) => seen.push(error));
    expect(seen).toEqual([{ kind: 'embed_blocked', code: 150 }]);
    expect(warn).toHaveBeenCalledWith('YouTube player error', { code: 150, kind: 'embed_blocked', videoId: 'abc' });
    warn.mockRestore();
  });
});

describe('volume', () => {
  afterEach(() => vi.unstubAllGlobals());

  const mount = async (getVolume?: () => number) => {
    const setVolume = vi.fn();
    class FakePlayer {
      setVolume = setVolume;
      getVolume = getVolume;
      constructor(_target: unknown, options: { events: { onReady: () => void } }) {
        queueMicrotask(() => options.events.onReady());
      }
    }
    const YT = { Player: FakePlayer };
    vi.stubGlobal('YT', YT);
    vi.stubGlobal('window', { YT, location: { origin: 'http://test' } });
    vi.stubGlobal('document', { createElement: () => ({}) });
    const player = await createYouTubePlayer({ replaceChildren: () => {} } as unknown as HTMLElement, 'abc', 0, true);
    return { player, setVolume };
  };

  it('converts to and from the 0 to 100 YouTube uses', async () => {
    const { player, setVolume } = await mount(() => 30);
    player.setVolume(0.25);
    expect(setVolume).toHaveBeenCalledWith(25);
    expect(player.volume()).toBe(0.3);
  });

  it('says so when a player cannot report its volume', async () => {
    const { player } = await mount();
    expect(player.volume()).toBeNull();
  });
});

describe('a player told to start', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says it is unstarted until YouTube reports anything else', async () => {
    let change: (event: { data: number }) => void = () => {};
    class FakePlayer {
      constructor(_target: unknown, options: { events: { onReady: () => void; onStateChange: typeof change } }) {
        change = options.events.onStateChange;
        queueMicrotask(() => options.events.onReady());
      }
    }
    const YT = { Player: FakePlayer };
    vi.stubGlobal('YT', YT);
    vi.stubGlobal('window', { YT, location: { origin: 'http://test' } });
    vi.stubGlobal('document', { createElement: () => ({}) });
    const player = await createYouTubePlayer({ replaceChildren: () => {} } as unknown as HTMLElement, 'abc', 0, true);

    expect(player.unstarted?.()).toBe(false);
    change({ data: -1 });
    expect(player.unstarted?.()).toBe(true);
    change({ data: 3 });
    expect(player.unstarted?.()).toBe(false);
  });
});

describe('createErrorChannel', () => {
  it('passes errors straight through once someone listens', () => {
    const channel = createErrorChannel();
    const seen: number[] = [];
    channel.listen((error) => seen.push(error.code));
    channel.report({ kind: 'network', code: 1 });
    channel.report({ kind: 'network', code: 2 });
    expect(seen).toEqual([1, 2]);
  });

  it('delivers an early error once', () => {
    const channel = createErrorChannel();
    channel.report({ kind: 'unknown', code: 5 });
    const seen: number[] = [];
    channel.listen((error) => seen.push(error.code));
    channel.listen((error) => seen.push(error.code));
    expect(seen).toEqual([5]);
  });
});

describe('a player mounted in a paused room', () => {
  afterEach(() => vi.unstubAllGlobals());

  const mount = async (autoplay: boolean) => {
    type Options = { playerVars: { autoplay: number; start: number }; events: { onReady: () => void } };
    const cued: unknown[][] = [];
    let vars: Options['playerVars'] | undefined;
    class FakePlayer {
      cueVideoById = (...args: unknown[]) => cued.push(args);
      constructor(_target: unknown, options: Options) {
        vars = options.playerVars;
        queueMicrotask(() => options.events.onReady());
      }
    }
    const YT = { Player: FakePlayer };
    vi.stubGlobal('YT', YT);
    vi.stubGlobal('window', { YT, location: { origin: 'http://test' } });
    vi.stubGlobal('document', { createElement: () => ({}) });
    const player = await createYouTubePlayer({ replaceChildren: () => {} } as unknown as HTMLElement, 'abc', 724.6, autoplay);
    return { player, cued, vars };
  };

  it('does not start by itself', async () => {
    expect((await mount(false)).vars).toMatchObject({ autoplay: 0, start: 724 });
  });

  it('starts by itself in a playing room', async () => {
    expect((await mount(true)).vars).toMatchObject({ autoplay: 1 });
  });

  it('cues the video at the exact position', async () => {
    const { player, cued } = await mount(false);
    player.cue(724.6);
    expect(cued).toEqual([['abc', 724.6]]);
  });
});

describe('a browser refusing to autoplay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reaches a listener that subscribes afterwards', async () => {
    type Events = { onReady: () => void; onAutoplayBlocked: () => void };
    class FakePlayer {
      constructor(_target: unknown, options: { events: Events }) {
        queueMicrotask(() => {
          options.events.onAutoplayBlocked();
          options.events.onReady();
        });
      }
    }
    const YT = { Player: FakePlayer };
    vi.stubGlobal('YT', YT);
    vi.stubGlobal('window', { YT, location: { origin: 'http://test' } });
    vi.stubGlobal('document', { createElement: () => ({}) });
    const player = await createYouTubePlayer({ replaceChildren: () => {} } as unknown as HTMLElement, 'abc', 0, true);
    const blocked = vi.fn();
    player.onBlocked(blocked);
    expect(blocked).toHaveBeenCalledOnce();
  });
});

describe('createErrorChannel', () => {
  it('passes errors straight through once someone listens', () => {
    const channel = createErrorChannel();
    const seen: number[] = [];
    channel.listen((error) => seen.push(error.code));
    channel.report({ kind: 'network', code: 1 });
    channel.report({ kind: 'network', code: 2 });
    expect(seen).toEqual([1, 2]);
  });

  it('delivers an early error once', () => {
    const channel = createErrorChannel();
    channel.report({ kind: 'unknown', code: 5 });
    const seen: number[] = [];
    channel.listen((error) => seen.push(error.code));
    channel.listen((error) => seen.push(error.code));
    expect(seen).toEqual([5]);
  });
});
