// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { useWatched } from './useWatched';

const room = (...ids: string[]) => ({ queue: ids.map((id) => ({ id })) }) as unknown as RoomView;

describe('useWatched', () => {
  afterEach(cleanup);

  it('remembers what played, once each, after the queue is empty', () => {
    const { result, rerender } = renderHook(({ view }) => useWatched(view), { initialProps: { view: room('a', 'b') } });
    rerender({ view: room('a', 'b') });
    rerender({ view: room('b') });
    rerender({ view: room() });
    expect(result.current.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('leaves out what was queued and never came on', () => {
    const { result } = renderHook(() => useWatched(room('a', 'b', 'c')));
    expect(result.current.map(({ id }) => id)).toEqual(['a']);
  });
});
