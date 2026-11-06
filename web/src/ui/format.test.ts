import { describe, expect, it } from 'vitest';
import { formatTime, initials, looksLikeUrl, normalizeUrl } from './format';

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
});
