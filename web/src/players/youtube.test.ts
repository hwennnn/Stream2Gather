import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createErrorChannel, type PlayerError } from './types';
import { createYouTubePlayer, loadApi } from './youtube';

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
    vi.stubGlobal('window', { YT, location: { origin: 'http://test' } });
    vi.stubGlobal('document', { createElement: () => ({}) });

    const player = await createYouTubePlayer({ replaceChildren: () => {} } as unknown as HTMLElement, 'abc', 0);
    const seen: PlayerError[] = [];
    player.onError((error) => seen.push(error));
    expect(seen).toEqual([{ kind: 'embed_blocked', code: 150 }]);
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
