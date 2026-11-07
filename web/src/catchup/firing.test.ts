import { describe, expect, it } from 'vitest';
import { createFiring, posMsAt } from './firing';

const at = (...seconds: number[]) => seconds.map((second) => ({ posMs: second * 1000 }));
const fired = (moments: { posMs: number }[]) => moments.map((moment) => moment.posMs / 1000);

/** Plays from one time to another, four polls a second at this rate. */
const play = (firing: ReturnType<typeof createFiring<{ posMs: number }>>, from: number, to: number, rate = 1) => {
  const all: number[] = [];
  for (let time = from; time <= to; time += 0.25 * rate) all.push(...fired(firing.tick(time, true)));
  return all;
};

describe('firing', () => {
  it('fires each moment once, within a poll of reaching it, during normal play', () => {
    const firing = createFiring(at(1, 2, 2, 3.1));
    firing.tick(0, true);

    expect(fired(firing.tick(0.75, true))).toEqual([]);
    expect(fired(firing.tick(1, true))).toEqual([1]);
    expect(play(firing, 1.25, 4)).toEqual([2, 2, 3.1]);
  });

  it('fires a moment at the very start', () => {
    const firing = createFiring(at(0));
    firing.tick(0, true);

    expect(fired(firing.tick(0.25, true))).toEqual([0]);
  });

  it('never bursts on a seek forward', () => {
    const firing = createFiring(at(5, 6, 7, 40));
    firing.tick(0, true);

    expect(fired(firing.tick(30, true))).toEqual([]);
    expect(play(firing, 30.25, 41)).toEqual([40]);
    expect(fired(firing.passed())).toEqual([5, 6, 7, 40]);
  });

  it('fires again after a seek back, and not during it', () => {
    const firing = createFiring(at(5, 10));
    firing.tick(0, true);
    play(firing, 0.25, 11);

    expect(fired(firing.tick(4, true))).toEqual([]);
    expect(fired(firing.passed())).toEqual([]);
    expect(play(firing, 4.25, 6)).toEqual([5]);
  });

  it('does not count a small step back as play', () => {
    const firing = createFiring(at(5));
    firing.tick(4.9, true);
    play(firing, 5, 5.5);

    expect(fired(firing.tick(4.5, true))).toEqual([]);
    expect(play(firing, 4.75, 5.25)).toEqual([5]);
  });

  it('holds still while paused, wherever the paused player is moved to', () => {
    const firing = createFiring(at(5, 6));
    firing.tick(4.9, true);

    expect(fired(firing.tick(4.9, false))).toEqual([]);
    expect(fired(firing.tick(5.5, false))).toEqual([]);
    expect(play(firing, 5.75, 6.5)).toEqual([6]);
  });

  it('keeps up at double speed', () => {
    const firing = createFiring(at(1, 2, 3));
    firing.tick(0, true);

    expect(play(firing, 0.5, 4, 2)).toEqual([1, 2, 3]);
  });

  it('treats a stall longer than the jump limit as a jump', () => {
    const firing = createFiring(at(3));
    firing.tick(0, true);

    expect(fired(firing.tick(2.5, true))).toEqual([]);
  });

  it('keeps your own reaction behind the cursor', () => {
    const firing = createFiring(at(1, 9));
    firing.tick(0, true);
    play(firing, 0.25, 5);

    firing.add({ posMs: 5000 });

    expect(fired(firing.passed())).toEqual([1, 5]);
    expect(play(firing, 5.25, 10)).toEqual([9]);
  });

  it.each([5.0006, 5.0004, 5])('keeps a reaction left at %ss on the rail, paused there', (time) => {
    const firing = createFiring(at(1));
    firing.tick(4.75, true); // The video pauses, and the reaction lands before the next poll.

    firing.add({ posMs: posMsAt(time) });
    firing.tick(time, false);
    firing.tick(time, false);

    expect(firing.passed()).toHaveLength(2);
  });

  it('keeps a reaction left before the video has moved', () => {
    const firing = createFiring(at(1));
    firing.tick(0, false);

    firing.add({ posMs: posMsAt(0) });
    firing.tick(0, false);

    expect(firing.passed()).toHaveLength(1);
  });
});
