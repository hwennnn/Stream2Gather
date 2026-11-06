import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHtml5Player } from './html5';

class FakeVideo extends EventTarget {
  ended = false;
  paused = true;
  canPlayType = () => '';
  load = () => {};
  removeAttribute = () => {};
  play = async () => {};
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
});
