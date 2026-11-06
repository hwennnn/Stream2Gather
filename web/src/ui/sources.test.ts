import { describe, expect, it } from 'vitest';
import { addPrompt, sourceName } from './sources';

describe('addPrompt', () => {
  it('keeps to YouTube when nothing else is on', () => {
    expect(addPrompt(['youtube'])).toBe('Paste a link or search YouTube');
    expect(addPrompt([])).toBe('Paste a link or search YouTube');
  });

  it('names each link source that is on', () => {
    expect(addPrompt(['youtube', 'direct'])).toBe('Search YouTube or paste a .m3u8 link');
    expect(addPrompt(['youtube', 'vimeo', 'twitch', 'direct'])).toBe('Search YouTube or paste a Vimeo, Twitch or .m3u8 link');
  });
});

describe('sourceName', () => {
  it('falls back to the id of a source it has no name for', () => {
    expect(sourceName('youtube')).toBe('YouTube');
    expect(sourceName('peertube')).toBe('peertube');
  });
});
