import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHtml5Player, hlsError } from './html5';

class FakeVideo extends EventTarget {
  ended = false;
  paused = true;
  canPlayType = () => '';
  load = () => {};
  removeAttribute = () => {};
  play: () => Promise<void> = async () => {};
  pause = () => {};
}

const mount = async () => {
  const video = new FakeVideo();
  vi.stubGlobal('document', { createElement: () => video });
  vi.stubGlobal('window', { location: { href: 'http://test/' } });
  const player = await createHtml5Player({ replaceChildren() {} } as unknown as HTMLElement, 'http://test/a.mp4', 0);
  const states: string[] = [];
  player.onState((state) => states.push(state));
  return { video, player, states };
};

describe('createHtml5Player', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('says when the browser refuses to play', async () => {
    const { video, player } = await mount();
    const blocked = vi.fn();
    player.onBlocked(blocked);
    video.play = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    player.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(blocked).toHaveBeenCalledOnce();
  });

  it('does not take a play cut short by a pause for a refusal', async () => {
    const { video, player } = await mount();
    const blocked = vi.fn();
    player.onBlocked(blocked);
    video.play = () => Promise.reject(Object.assign(new Error('no'), { name: 'AbortError' }));
    player.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(blocked).not.toHaveBeenCalled();
  });

  it('reports a viewer pausing', async () => {
    const { video, states } = await mount();
    video.dispatchEvent(new Event('pause'));
    expect(states).toEqual(['paused']);
  });

  it('does not report the pause a video makes on reaching its end', async () => {
    const { video, player, states } = await mount();
    video.dispatchEvent(new Event('playing'));
    video.ended = true;
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('ended'));
    expect(states).toEqual(['playing', 'ended']);
    expect(player.state()).toBe('ended');
  });

  it('reads back the volume it was given', async () => {
    const { player } = await mount();
    player.setVolume(0.3);
    expect(player.volume()).toBe(0.3);
  });
});

describe('hlsError', () => {
  it('reads a request with no status as a host that refused us', () => {
    expect(hlsError(true, 0, true)).toEqual({ kind: 'embed_blocked', code: 0 });
  });

  it('does not blame the host when this viewer is offline', () => {
    expect(hlsError(true, 0, false)).toEqual({ kind: 'network', code: 0 });
  });

  it('keeps a real status as a network error', () => {
    expect(hlsError(true, 404, true)).toEqual({ kind: 'network', code: 404 });
  });

  it('calls anything else unavailable', () => {
    expect(hlsError(false, 0, true)).toEqual({ kind: 'unavailable', code: 0 });
  });
});
