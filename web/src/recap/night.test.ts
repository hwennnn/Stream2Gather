import { describe, expect, it } from 'vitest';
import type { Moment } from '../catchup/api';
import { hueOf } from '../ui/people';
import { dotsOf, wordsAround } from './night';
import { nightOf, whoReacted } from './words';

const moment = (change: Partial<Moment>): Moment => ({ id: 1, posMs: 0, kind: 'reaction', origin: 'live', author: 'Hana', userId: 'u1', emoji: '🔥', ...change });
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 30).toISOString();
const NOW = new Date(2026, 10, 9, 12).getTime();

describe('nightOf', () => {
  it('names a night the way the people there would', () => {
    expect(nightOf(at(6, 21), NOW)).toBe('Friday night');
    expect(nightOf(at(7, 14), NOW)).toBe('Saturday afternoon');
    expect(nightOf(at(8, 9), NOW)).toBe('Sunday morning');
  });

  it('keeps the small hours with the night before', () => {
    expect(nightOf(at(7, 1), NOW)).toBe('Friday night');
  });

  it('adds the date once a weekday would be ambiguous', () => {
    expect(nightOf(at(1, 21), NOW)).toBe('Sunday night, Nov 1');
  });
});

describe('whoReacted', () => {
  it('speaks to the people who were there, and about them to anyone else', () => {
    expect(whoReacted(3, 3, true)).toBe('All of you reacted');
    expect(whoReacted(2, 5, true)).toBe('2 of you reacted');
    expect(whoReacted(3, 3, false)).toBe('3 people reacted');
  });
});

describe('dotsOf', () => {
  it('places each person in their own colour along the video', () => {
    expect(dotsOf([moment({ posMs: 500 })], 1000)).toEqual([{ left: 50, color: hueOf('u1') }]);
  });

  it('draws a burst from one person as one dot, and two people as two', () => {
    const burst = [moment({ id: 1, posMs: 500 }), moment({ id: 2, posMs: 501 }), moment({ id: 3, posMs: 500, userId: 'u2' })];
    expect(dotsOf(burst, 1000)).toHaveLength(2);
  });

  it('leaves someone whose account has gone neutral', () => {
    expect(dotsOf([moment({ userId: undefined })], 1000)[0]?.color).toBe('var(--color-dim)');
  });

  it('draws nothing on a video of unknown length', () => {
    expect(dotsOf([moment({})], 0)).toEqual([]);
  });
});

describe('wordsAround', () => {
  it('keeps the live lines near the moment, and at most three', () => {
    const line = (id: number, posMs: number, origin: Moment['origin'] = 'live') => moment({ id, posMs, kind: 'chat', origin, body: `${id}` });
    const moments = [line(1, 1000), line(2, 95_000), line(3, 100_000), line(4, 101_000, 'catchup'), moment({ id: 5, posMs: 102_000 }), line(6, 103_000), line(7, 104_000), line(8, 500_000)];
    expect(wordsAround(moments, 100_000).map(({ id }) => id)).toEqual([2, 3, 6]);
  });
});
