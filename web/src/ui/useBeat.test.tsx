// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../room/session';
import { beatAt, useBeat } from './useBeat';

const person = (userId: string, name = userId) => ({ userId, name, role: 'member' as const });
const ada = person('a', 'Ada');
const bo = person('b', 'Bo');
const cy = person('c', 'Cy');
const view = (patch: Partial<RoomView> = {}) => ({ self: ada, members: [ada, bo], lastAction: null, ...patch }) as unknown as RoomView;

const mount = (first = view()) => renderHook(({ room }) => useBeat(room), { initialProps: { room: first } });

describe('useBeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('sits you down when you walk in, and only you', () => {
    expect(mount().result.current).toEqual({ kind: 'arrive', from: ['a'] });
  });

  it('is over by itself, with nothing left running', () => {
    const { result } = mount();
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('doesn’t take the people already here for new arrivals when they come after you', () => {
    const { result, rerender } = mount(view({ members: [] }));
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ room: view() });
    expect(result.current).toBeNull();
  });

  it('starts at whoever came in, and shares a beat with whoever came in with them', () => {
    const { result, rerender } = mount();
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ room: view({ members: [ada, bo, cy] }) });
    expect(result.current).toEqual({ kind: 'arrive', from: ['c'] });
    rerender({ room: view({ members: [ada, bo, cy, person('d')] }) });
    expect(result.current).toEqual({ kind: 'arrive', from: ['c', 'd'] });
  });

  it('marks someone leaving', () => {
    const { result, rerender } = mount();
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ room: view({ members: [ada] }) });
    expect(result.current).toEqual({ kind: 'leave', from: ['b'] });
  });

  it.each([
    ['pause', 'hold'],
    ['play', 'go'],
    ['seek', 'act'],
    ['skip', 'act'],
  ])('starts a %s at whoever did it', (cause, kind) => {
    const { result, rerender } = mount();
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ room: view({ lastAction: { by: 'Bo', cause } }) });
    expect(result.current).toEqual({ kind, from: ['b'] });
  });

  it('has no seat to start from for someone who has gone', () => {
    const { result, rerender } = mount();
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ room: view({ lastAction: { by: 'Gone', cause: 'pause' } }) });
    expect(result.current).toEqual({ kind: 'hold', from: [] });
  });

  it('ignores what isn’t a person moving the room', () => {
    const { result, rerender } = mount();
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ room: view({ lastAction: { by: 'Bo', cause: 'queue.add' } }) });
    expect(result.current).toBeNull();
  });
});

describe('beatAt', () => {
  it('counts seats from the nearest origin, and points back at it', () => {
    expect(beatAt(0, [3])).toEqual({ dist: 3, toward: 1 });
    expect(beatAt(5, [3])).toEqual({ dist: 2, toward: -1 });
    expect(beatAt(4, [0, 5])).toEqual({ dist: 1, toward: 1 });
  });

  it('leaves the row still when nobody started it', () => {
    expect(beatAt(2, [])).toEqual({ dist: 0, toward: 0 });
  });
});
