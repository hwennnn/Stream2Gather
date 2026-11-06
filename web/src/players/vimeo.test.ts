import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVimeoPlayer } from './vimeo';

const sdk = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@vimeo/player', () => ({
  default: function FakeVimeo() {
    return sdk.current;
  },
}));

const mount = async () => {
  const handlers = new Map<string, (data: never) => void>();
  const landings: (() => void)[] = [];
  const setPlaybackRate = vi.fn(() => Promise.resolve());
  const play = vi.fn(() => Promise.resolve());
  sdk.current = {
    on: (event: string, handler: (data: never) => void) => handlers.set(event, handler),
    ready: () => Promise.resolve(),
    getVolume: () => Promise.resolve(1),
    getMuted: () => Promise.resolve(false),
    play,
    setPlaybackRate,
    setCurrentTime: () => new Promise<void>((resolve) => landings.push(resolve)),
  };
  const frame: { src?: string } = {};
  vi.stubGlobal('document', { createElement: () => frame });
  const player = await createVimeoPlayer({ replaceChildren() {} } as unknown as HTMLElement, '123:abc', 7, false);
  const fire = (event: string, data: unknown = {}) => handlers.get(event)?.(data as never);
  return { player, fire, landings, setPlaybackRate, play, frame };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('createVimeoPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens an unlisted video with its hash, at the room position', async () => {
    const { frame } = await mount();
    expect(frame.src).toContain('/video/123?');
    expect(frame.src).toContain('h=abc');
    expect(frame.src).toContain('#t=7s');
  });

  // Measured on the real player: a cold load took 13 s and read as a jump back,
  // which moved the whole room.
  it('does not count time spent loading as time played', async () => {
    const { player, fire } = await mount();
    player.play();
    await vi.advanceTimersByTimeAsync(13_000);
    fire('playing', { seconds: 7 });
    expect(player.time()).toBeCloseTo(7, 1);
  });

  it('does not count time spent seeking as time played', async () => {
    const { player, fire, landings } = await mount();
    fire('playing', { seconds: 7 });
    player.seek(20);
    await vi.advanceTimersByTimeAsync(3000);
    landings[0]?.();
    await flush();
    expect(player.state()).toBe('playing');
    expect(player.time()).toBeCloseTo(20, 1);
  });

  it('says it is buffering while a seek or a first play is on its way', async () => {
    const { player, fire } = await mount();
    player.play();
    expect(player.state()).toBe('buffering');
    fire('playing', { seconds: 7 });
    player.seek(20);
    expect(player.state()).toBe('buffering');
  });

  it('ignores positions from before a seek that has not landed', async () => {
    const { player, fire, landings } = await mount();
    fire('playing', { seconds: 7 });
    player.seek(20);
    fire('timeupdate', { seconds: 7.25, duration: 600 });
    expect(player.duration()).toBe(600);
    fire('playing', { seconds: 7.3 });
    expect(player.time()).toBe(20);
    expect(player.state()).toBe('buffering');
    landings[0]?.();
    await flush();
    expect(player.state()).toBe('playing');
  });

  it('waits for the latest of several seeks', async () => {
    const { player, fire, landings } = await mount();
    fire('playing', { seconds: 7 });
    player.seek(20);
    player.seek(30);
    landings[0]?.();
    await flush();
    expect(player.state()).toBe('buffering');
    landings[1]?.();
    await flush();
    expect(player.state()).toBe('playing');
    expect(player.time()).toBeCloseTo(30, 1);
  });

  it('goes back to ready when the browser refuses to play, so autoplay can step in', async () => {
    const { player, play } = await mount();
    const refused = vi.fn();
    player.onBlocked(refused);
    play.mockRejectedValueOnce(Object.assign(new Error('refused'), { name: 'NotAllowedError' }));
    player.play();
    await flush();
    expect(player.state()).toBe('ready');
    expect(refused).toHaveBeenCalledTimes(1);
    play.mockRejectedValueOnce(new Error('network'));
    player.play();
    await flush();
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('does not report the pause a video makes on reaching its end', async () => {
    const { player, fire } = await mount();
    fire('playing', { seconds: 60 });
    fire('pause', { percent: 1 });
    fire('ended');
    expect(player.state()).toBe('ended');
  });

  it('falls back to seeking when the uploader’s plan has no speed control', async () => {
    const { player, setPlaybackRate } = await mount();
    expect(player.rates).toBe('fine');
    setPlaybackRate.mockRejectedValueOnce(new Error('speed is off'));
    player.setRate(1.05);
    await flush();
    expect(player.rates).toBe('none');
    player.setRate(1.05);
    expect(setPlaybackRate).toHaveBeenCalledOnce();
  });

  it('reports a video that fails, but not a failed call', async () => {
    const { player, fire } = await mount();
    const seen: string[] = [];
    player.onError((error) => seen.push(error.kind));
    fire('error', { name: 'PrivacyError' });
    expect(seen).toEqual(['embed_blocked']);
    fire('error', { name: 'RangeError', method: 'setCurrentTime' });
    expect(seen).toEqual(['embed_blocked']);
  });
});
