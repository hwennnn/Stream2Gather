import { describe, expect, it } from 'vitest';
import { formatTime, initials, isYouTubeUrl, looksLikeUrl, normalizeUrl, plural, splitLinks } from './format';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [9.9, '0:09'],
    [75, '1:15'],
    [3671, '1:01:11'],
    [-4, '0:00'],
  ])('formats %s', (seconds, expected) => {
    expect(formatTime(seconds)).toBe(expected);
  });
});

describe('looksLikeUrl', () => {
  it('separates links from searches', () => {
    expect(looksLikeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(looksLikeUrl('youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(looksLikeUrl('lofi hip hop')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('adds a scheme only when missing', () => {
    expect(normalizeUrl(' youtu.be/x ')).toBe('https://youtu.be/x');
    expect(normalizeUrl('http://a.test/v.mp4')).toBe('http://a.test/v.mp4');
  });
});

describe('initials', () => {
  it('uses at most two words', () => {
    expect(initials('Lucky Otter Friend')).toBe('LO');
  });

  it('keeps an emoji whole', () => {
    expect(initials('🦊')).toBe('🦊');
    expect(initials('👩‍🚀 Ada')).toBe('👩‍🚀A');
  });

  it('survives an empty name', () => {
    expect(initials('   ')).toBe('');
  });
});

describe('isYouTubeUrl', () => {
  it('knows YouTube from everything else', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true);
    expect(isYouTubeUrl('youtu.be/x')).toBe(true);
    expect(isYouTubeUrl('https://notyoutube.com/watch?v=x')).toBe(false);
    expect(isYouTubeUrl('https://vimeo.com/1')).toBe(false);
  });
});

describe('splitLinks', () => {
  it('finds links and leaves closing punctuation out', () => {
    expect(splitLinks('see https://a.test/x, ok')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://a.test/x', href: 'https://a.test/x' },
      { kind: 'text', text: ', ok' },
    ]);
  });

  it('adds a scheme to bare www links', () => {
    expect(splitLinks('www.a.test')).toEqual([{ kind: 'link', text: 'www.a.test', href: 'https://www.a.test' }]);
  });

  it('leaves plain text alone', () => {
    expect(splitLinks('no links here')).toEqual([{ kind: 'text', text: 'no links here' }]);
  });
});

describe('plural', () => {
  it('counts', () => {
    expect(plural(1, 'video')).toBe('1 video');
    expect(plural(4, 'video')).toBe('4 videos');
  });
});
