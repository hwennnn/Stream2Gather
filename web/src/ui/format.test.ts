import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColor, formatTime, initials, isYouTubeUrl, looksLikeUrl, normalizeUrl, plural, splitLinks } from './format';

const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
};

const hue = (hex: string) => {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  const turn = max === r ? (g - b) / span : max === g ? 2 + (b - r) / span : 4 + (r - g) / span;
  return (turn * 60 + 360) % 360;
};

describe('avatar colours', () => {
  it('has enough to go round a full room', () => {
    expect(new Set(AVATAR_COLORS).size).toBeGreaterThanOrEqual(12);
  });

  it('keeps every colour its own hue, so two people never look alike', () => {
    const hues = AVATAR_COLORS.map(hue).sort((a, b) => a - b);
    const gaps = hues.map((value, index) => (hues[index + 1] ?? (hues[0] ?? 0) + 360) - value);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(15);
  });

  it('stays readable as a name on the panel and behind dark initials', () => {
    for (const color of AVATAR_COLORS) {
      expect(contrast(color, '#121730')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color, '#0b0f1e')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the whole palette and gives one person one colour', () => {
    const seen = new Set(Array.from({ length: 400 }, (_, index) => avatarColor(`g_${index * 7919}`)));
    expect(seen.size).toBe(AVATAR_COLORS.length);
    expect(avatarColor('g_1')).toBe(avatarColor('g_1'));
  });
});

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
