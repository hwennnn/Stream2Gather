import { afterEach, describe, expect, it } from 'vitest';
import { AVATAR_COLORS, hueOf, placeHues, setRoomHues } from './people';

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

  it('leaves error red and link blue to their own jobs', () => {
    const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const color of AVATAR_COLORS) {
      expect(apart(hue(color), hue('#e0806f'))).toBeGreaterThanOrEqual(12);
      expect(apart(hue(color), hue('#93bbe8'))).toBeGreaterThanOrEqual(15);
    }
  });

  it('uses the whole palette and gives one person one colour', () => {
    const seen = new Set(Array.from({ length: 400 }, (_, index) => hueOf(`g_${index * 7919}`)));
    expect(seen.size).toBe(AVATAR_COLORS.length);
    expect(hueOf('g_1')).toBe(hueOf('g_1'));
  });
});

describe('placeHues', () => {
  const crowd = Array.from({ length: 12 }, (_, index) => `guest-${index}`);
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), AVATAR_COLORS.length - Math.abs(a - b));

  it('gives everyone in a full room a colour of their own', () => {
    const hues = placeHues({}, crowd);
    expect(new Set(crowd.map((id) => hues[id])).size).toBe(crowd.length);
  });

  it('keeps a small room clear of near matches, not just exact ones', () => {
    const people = crowd.slice(0, 5);
    const hues = placeHues({}, people);
    const placed = people.map((id) => hues[id] ?? 0);
    for (const [index, hue] of placed.entries()) for (const other of placed.slice(index + 1)) expect(apart(hue, other)).toBeGreaterThanOrEqual(2);
  });

  it('never recolours someone who’s here when a newcomer arrives', () => {
    const before = placeHues({}, crowd.slice(0, 6));
    const after = placeHues(before, crowd.slice(0, 8));
    for (const id of crowd.slice(0, 6)) expect(after[id]).toBe(before[id]);
  });

  it('keeps a colour after whoever shaped it has gone', () => {
    const before = placeHues({}, crowd.slice(0, 6));
    const after = placeHues(before, crowd.slice(3, 6));
    for (const id of crowd.slice(3, 6)) expect(after[id]).toBe(before[id]);
  });

  it('moves someone returning only if their colour was taken while they were gone', () => {
    const hues = placeHues({ back: 3, here: 3 }, ['here', 'back']);
    expect(hues.here).toBe(3);
    expect(hues.back).not.toBe(3);
  });

  it('repeats a colour only once there are more people than colours', () => {
    const many = Array.from({ length: 14 }, (_, index) => `p${index}`);
    expect(new Set(Object.values(placeHues({}, many))).size).toBe(AVATAR_COLORS.length);
  });
});

describe('hueOf', () => {
  afterEach(() => setRoomHues({}));

  it('is someone’s usual colour outside a room, and the room’s inside one', () => {
    const usual = hueOf('ada');
    const other = AVATAR_COLORS.findIndex((hue) => hue !== usual);
    setRoomHues({ ada: other });
    expect(hueOf('ada')).toBe(AVATAR_COLORS[other]);
    setRoomHues({});
    expect(hueOf('ada')).toBe(usual);
  });
});
