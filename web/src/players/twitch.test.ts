// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwitchPlayer } from './twitch';
import type { EmbedOptions } from './twitchEmbed';

vi.mock('../api/http', () => ({ api: { config: () => Promise.resolve({ twitchParent: 'localhost' }) } }));

class FakeEmbed {
  static READY = 'ready';
  static PLAYING = 'playing';
  static PAUSE = 'pause';
  static ENDED = 'ended';
  static OFFLINE = 'offline';
  static PLAYBACK_BLOCKED = 'blocked';
  handlers = new Map<string, () => void>();
  calls: string[] = [];
  seconds = 0;
  paused = true;
  destroyed = false;
  constructor(_target: HTMLElement, public options: EmbedOptions) {
    embeds.push(this);
  }
  fire = (event: string) => this.handlers.get(event)?.();
  addEventListener = (event: string, listener: () => void) => this.handlers.set(event, listener);
  seek = (seconds: number) => this.calls.push(`seek:${seconds}`);
  pause = () => this.handlers.get('pause')?.();
  play = () => {};
  isPaused = () => this.paused;
  getCurrentTime = () => this.seconds;
  getDuration = () => 600;
  destroy = () => {
    this.destroyed = true;
  };
}

const embeds: FakeEmbed[] = [];

const sized = (width: () => number) => {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { get: width });
  Object.defineProperty(element, 'clientHeight', { get: () => 450 });
  return element;
};
const wide = () => sized(() => 800);

const flush = async () => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

const mount = async (element: HTMLElement, sourceId = 'video:42', startAt = 90, autoplay = true) => {
  const pending = createTwitchPlayer(element, sourceId, 'https://www.twitch.tv/videos/42', startAt, autoplay);
  await flush();
  embeds.at(-1)?.fire('ready');
  return pending;
};

describe('createTwitchPlayer', () => {
  beforeEach(() => {
    embeds.length = 0;
    vi.useFakeTimers();
    window.Twitch = { Player: FakeEmbed as never };
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens a video muted, at the room position, for this site', async () => {
    await mount(wide());
    expect(embeds[0]?.options).toMatchObject({ video: '42', time: '0h1m30s', muted: true, autoplay: true, parent: ['localhost'] });
  });

  it('calls a channel found offline unavailable, and one going offline finished', async () => {
    const seen: string[] = [];
    const element = wide();
    const pending = createTwitchPlayer(element, 'channel:quiet', '', 0, true);
    await flush();
    embeds[0]?.fire('offline');
    (await pending).onError((error) => seen.push(error.kind));
    expect(seen).toEqual(['unavailable']);

    const player = await mount(wide(), 'channel:lofi');
    embeds[1]?.fire('playing');
    embeds[1]?.fire('offline');
    expect(player.state()).toBe('ended');
  });

  // Seen on the real embed. Reported straight away, it pauses the room for everyone.
  it('does not take the embed pausing itself for a moment as the viewer pausing', async () => {
    const player = await mount(wide());
    const seen: string[] = [];
    player.onState((state) => seen.push(state));
    embeds[0]?.fire('playing');
    embeds[0]?.fire('pause');
    embeds[0]?.fire('playing');
    vi.advanceTimersByTime(5000);
    expect(seen).not.toContain('paused');
  });

  it('believes a pause that lasts, and one the room asked for at once', async () => {
    const player = await mount(wide());
    embeds[0]?.fire('playing');
    embeds[0]?.fire('pause');
    expect(player.state()).toBe('buffering');
    vi.advanceTimersByTime(1500);
    expect(player.state()).toBe('paused');
    embeds[0]?.fire('playing');
    player.pause();
    expect(player.state()).toBe('paused');
  });

  it('gives a live channel the room clock, with nothing to seek', async () => {
    const player = await mount(wide(), 'channel:lofi', 50);
    expect(embeds[0]?.options).toMatchObject({ channel: 'lofi' });
    expect(embeds[0]?.options.time).toBeUndefined();
    player.seek(80);
    expect(player.time()).toBe(80);
    expect(embeds[0]?.calls).toEqual([]);
    expect(player.duration()).toBeNull();
  });
});
