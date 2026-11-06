// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AVATAR_COLORS, hueOf } from './people';
import { placeHues, useRoomHues } from './useRoomHues';

const Room = ({ ids }: { ids: string[] }) => {
  useRoomHues('room', ids.map((userId) => ({ userId })));
  return <p>{ids.map((id) => hueOf(id)).join(' ')}</p>;
};

const crowd = Array.from({ length: 8 }, (_, index) => `guest-${index}`);

describe('useRoomHues', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('colours the seats in the same pass that draws them', () => {
    const { container } = render(<Room ids={crowd} />);
    expect(new Set(container.textContent?.split(' ')).size).toBe(crowd.length);
  });

  it('survives a reload, even when the people who shaped it have gone', () => {
    const first = render(<Room ids={crowd} />);
    const hues = first.container.textContent?.split(' ') ?? [];
    first.unmount();
    const reloaded = render(<Room ids={crowd.slice(-2)} />);
    expect(reloaded.container.textContent?.split(' ')).toEqual(hues.slice(-2));
  });

  it('hands back everyone’s usual colour when the room closes', () => {
    const usual = hueOf('guest-1');
    render(<Room ids={crowd} />).unmount();
    expect(hueOf('guest-1')).toBe(usual);
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
