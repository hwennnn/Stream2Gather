import { describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { isApart, placeDots, playheadOffset } from './playheads';

const view = (patch: Partial<RoomView>) =>
  ({ playback: { status: 'playing', rate: 1 }, viewerDrift: {}, viewerStates: {}, ...patch }) as unknown as RoomView;

describe('playheadOffset', () => {
  it('is on the room for someone who never reported', () => {
    expect(playheadOffset(view({}), 'a', 5000)).toBe(0);
  });

  it('holds a reported drift while their player runs', () => {
    expect(playheadOffset(view({ viewerDrift: { a: { drift: -4, at: 1000 } }, viewerStates: { a: 'correcting' } }), 'a', 9000)).toBe(-4);
  });

  it('keeps falling behind for someone whose player has stopped', () => {
    const stuck = { viewerDrift: { a: { drift: -1, at: 1000 } } };
    expect(playheadOffset(view({ ...stuck, viewerStates: { a: 'buffering' } }), 'a', 6000)).toBe(-6);
    expect(playheadOffset(view({ ...stuck, viewerStates: { a: 'stalled' } }), 'a', 6000)).toBe(-6);
  });

  it('has everyone together while the room is paused', () => {
    const paused = view({ playback: { status: 'paused', rate: 1 } as RoomView['playback'], viewerDrift: { a: { drift: -9, at: 0 } } });
    expect(playheadOffset(paused, 'a', 9000)).toBe(0);
  });
});

describe('isApart', () => {
  it('leaves a report’s ordinary wobble with the room', () => {
    expect(isApart(0)).toBe(false);
    expect(isApart(-0.6)).toBe(false);
  });

  it('peels off anyone a second or more away, either side', () => {
    expect(isApart(-1)).toBe(true);
    expect(isApart(4)).toBe(true);
  });
});

describe('placeDots', () => {
  it('puts someone behind to the left of the room, in step with how far', () => {
    const [together = 0, near = 0, far = 0] = placeDots([0, -5, -20]);
    expect(far).toBeLessThan(near);
    expect(near).toBeLessThan(together);
  });

  it('gives each person a dot of their own when they share a frame', () => {
    expect(new Set(placeDots([0, 0, 0, 0])).size).toBe(4);
  });

  it('keeps every dot on the track, however far off and however full the room', () => {
    const dots = placeDots([-900, 900, ...Array.from({ length: 48 }, () => 0)]);
    expect(Math.min(...dots)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...dots)).toBeLessThanOrEqual(100);
  });
});
