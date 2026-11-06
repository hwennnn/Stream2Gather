import { describe, expect, it } from 'vitest';
import { followPointer } from './pointerDrag';

const pointer = (type: string, pointerId = 1, clientY = 0) =>
  Object.assign(new Event(type), { pointerId, clientY });

const follow = () => {
  const target = new EventTarget();
  const moves: number[] = [];
  const ends: boolean[] = [];
  const stop = followPointer(1, { onMove: (event) => moves.push(event.clientY), onEnd: (commit) => ends.push(commit) }, target);
  return { target, moves, ends, stop };
};

describe('followPointer', () => {
  it('reports moves, then commits on release', () => {
    const { target, moves, ends } = follow();
    target.dispatchEvent(pointer('pointermove', 1, 40));
    target.dispatchEvent(pointer('pointerup'));
    expect(moves).toEqual([40]);
    expect(ends).toEqual([true]);
  });

  it('cancels rather than commits on pointercancel', () => {
    const { target, ends } = follow();
    target.dispatchEvent(pointer('pointercancel'));
    expect(ends).toEqual([false]);
  });

  it('cancels when the capture is lost, as when the row is removed', () => {
    const { target, ends } = follow();
    target.dispatchEvent(pointer('lostpointercapture'));
    expect(ends).toEqual([false]);
  });

  it('ends once: a release is followed by losing the capture', () => {
    const { target, moves, ends } = follow();
    target.dispatchEvent(pointer('pointerup'));
    target.dispatchEvent(pointer('lostpointercapture'));
    target.dispatchEvent(pointer('pointermove', 1, 9));
    expect(ends).toEqual([true]);
    expect(moves).toEqual([]);
  });

  it('ignores other pointers', () => {
    const { target, moves, ends } = follow();
    target.dispatchEvent(pointer('pointermove', 2, 9));
    target.dispatchEvent(pointer('pointerup', 2));
    expect(moves).toEqual([]);
    expect(ends).toEqual([]);
  });

  it('stops without reporting an end', () => {
    const { target, ends, stop } = follow();
    stop();
    target.dispatchEvent(pointer('pointerup'));
    expect(ends).toEqual([]);
  });
});
