import { describe, expect, it } from 'vitest';
import { addPrompt, failureReason, openLabel, sourceName } from './sources';

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

describe('failureReason', () => {
  it('names the source that refused', () => {
    expect(failureReason('youtube', 'embed_blocked')).toBe('Its owner only allows it on YouTube.');
    expect(failureReason('vimeo', 'embed_blocked')).toBe('Its owner only allows it on Vimeo.');
    expect(failureReason('twitch', 'network')).toContain('blocking Twitch');
  });

  it('blames the stream, not a source, for a file', () => {
    expect(failureReason('direct', 'embed_blocked')).toBe('This stream doesn’t allow playback here.');
    expect(failureReason('direct', 'network')).toBe('The player couldn’t load. Check your connection.');
  });

  it('falls back for anything else', () => {
    expect(failureReason('vimeo', 'unavailable')).toContain('removed');
  });
});

describe('openLabel', () => {
  it('says where the link goes', () => {
    expect(openLabel('https://www.youtube.com/watch?v=a')).toBe('Open on YouTube');
    expect(openLabel('https://youtu.be/a')).toBe('Open on YouTube');
    expect(openLabel('https://vimeo.com/1')).toBe('Open on Vimeo');
    expect(openLabel('https://www.twitch.tv/videos/1')).toBe('Open on Twitch');
  });

  it('never trusts a lookalike host', () => {
    expect(openLabel('https://vimeo.com.evil.example/1')).toBe('Open the link');
    expect(openLabel('not a url')).toBe('Open the link');
  });
});
