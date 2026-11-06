import { describe, expect, it, vi } from 'vitest';
import { createHtml5Player } from './html5';
import { createPlayer } from './registry';
import { createYouTubePlayer } from './youtube';

vi.mock('./html5', () => ({ createHtml5Player: vi.fn() }));
vi.mock('./youtube', () => ({ createYouTubePlayer: vi.fn() }));

describe('createPlayer', () => {
  const element = {} as HTMLElement;

  it('gives YouTube the video id and everything else the url', () => {
    void createPlayer(element, { source: 'youtube', sourceId: 'abc', url: 'https://youtu.be/abc' }, 5);
    expect(createYouTubePlayer).toHaveBeenCalledWith(element, 'abc', 5);

    void createPlayer(element, { source: 'direct', sourceId: 'x', url: 'https://a.test/a.mp4' }, 5);
    expect(createHtml5Player).toHaveBeenCalledWith(element, 'https://a.test/a.mp4', 5);
  });
});
