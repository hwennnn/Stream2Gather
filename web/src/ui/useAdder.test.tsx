// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Media } from '../api/http';
import type { RoomSession, RoomView } from '../room/session';
import { useAdder } from './useAdder';

afterEach(cleanup);

const media = { source: 'youtube', sourceId: 'a', title: 'A' } as Media;
const session = { queueAdd: vi.fn(async () => {}) } as unknown as RoomSession;
const viewWith = (queue: Media[]) => ({ queue }) as unknown as RoomView;

describe('useAdder', () => {
  it('says a video is playing, not added, once it is the one on screen', async () => {
    const { result, rerender } = renderHook(({ view }) => useAdder(session, view), {
      initialProps: { view: viewWith([]) },
    });
    await act(async () => {
      await result.current.addMedia(media, 'now');
    });
    rerender({ view: viewWith([media]) });
    expect(result.current.statusOf(media)).toBe('playing');
  });

  it('says added for a video that went to the queue', async () => {
    const other = { source: 'youtube', sourceId: 'b', title: 'B' } as Media;
    const { result, rerender } = renderHook(({ view }) => useAdder(session, view), {
      initialProps: { view: viewWith([other]) },
    });
    await act(async () => {
      await result.current.addMedia(media, 'end');
    });
    rerender({ view: viewWith([other, media]) });
    expect(result.current.statusOf(media)).toBe('added');
  });
});
