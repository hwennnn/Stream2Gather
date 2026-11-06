// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClock, loadApi, stamp, tooSmallNotice } from './twitchEmbed';

describe('stamp', () => {
  it('writes the time the way the embed reads it', () => {
    expect(stamp(0)).toBe('0h0m0s');
    expect(stamp(3723.9)).toBe('1h2m3s');
  });
});

describe('createClock', () => {
  let now = 0;

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => vi.restoreAllMocks());

  it('only moves while it runs', () => {
    const clock = createClock(10);
    now = 5000;
    expect(clock.now()).toBe(10);
    clock.run();
    now = 7000;
    expect(clock.now()).toBe(12);
    clock.stop();
    now = 9000;
    expect(clock.now()).toBe(12);
  });

  it('keeps running from a new position', () => {
    const clock = createClock(0);
    clock.run();
    now = 1000;
    clock.set(40);
    now = 2000;
    expect(clock.now()).toBe(41);
  });
});

describe('tooSmallNotice', () => {
  it('says what to do and links out, never a shrunken embed', () => {
    const notice = tooSmallNotice('https://www.twitch.tv/videos/1');
    expect(notice.textContent).toContain('Rotate your phone or open on Twitch');
    expect(notice.querySelector('a')?.href).toBe('https://www.twitch.tv/videos/1');
    expect(notice.querySelector('iframe')).toBeNull();
  });
});

describe('loadApi', () => {
  afterEach(() => {
    document.head.replaceChildren();
    delete window.Twitch;
  });

  it('tries again after a failed load, so the next video gets a fresh attempt', async () => {
    const first = loadApi();
    document.head.querySelector('script')?.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('could not be loaded');
    const second = loadApi();
    const script = document.head.querySelector('script');
    expect(script?.src).toBe('https://player.twitch.tv/js/embed/v1.js');
    window.Twitch = { Player: vi.fn() as never };
    script?.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBe(window.Twitch);
  });
});
