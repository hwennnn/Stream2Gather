// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Media } from '../api/http';
import { MediaRow, useSearch } from './Omnibox';
import type { Adder } from './useAdder';

const media = (patch: Partial<Media> = {}): Media => ({
  source: 'youtube',
  sourceId: 'abc',
  url: 'https://www.youtube.com/watch?v=abc',
  title: 'A video',
  author: 'A channel',
  thumbnailUrl: '',
  durationMs: 1000,
  isLive: false,
  ...patch,
});

describe('a search result', () => {
  afterEach(cleanup);

  it('warns before anyone chooses a video players keep refusing', () => {
    render(<MediaRow media={media({ refused: true })} status="idle" onAdd={vi.fn()} />);
    expect(screen.getByText('Often won’t play here. YouTube has refused it for other viewers.')).toBeTruthy();
    // A mark can be wrong for this viewer, so the video stays choosable.
    expect(screen.getByRole('button', { name: 'Add: A video' })).toBeTruthy();
  });

  it('warns about a video the viewer’s region may not be able to watch', () => {
    render(<MediaRow media={media({ regionBlocked: true })} status="idle" onAdd={vi.fn()} />);
    expect(screen.getByText('May be blocked where you are.')).toBeTruthy();
  });

  it('makes Add the filled action, and keeps Play now behind ⋯', () => {
    const onAdd = vi.fn();
    render(<MediaRow media={media({})} status="idle" onAdd={onAdd} />);
    expect(screen.getByRole('button', { name: 'Add: A video' }).className).toContain('btn-primary');
    expect(screen.queryByRole('button', { name: 'Play now: A video' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More for A video' }));
    expect(screen.getByRole('button', { name: 'Play now' }).className).not.toContain('btn-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'A video' }), 'now');
  });

  it('says nothing about a video that plays', () => {
    render(<MediaRow media={media()} status="idle" onAdd={vi.fn()} />);
    expect(screen.queryByText(/won’t play here/)).toBeNull();
  });
});

describe('the add box', () => {
  afterEach(cleanup);

  const adding = () => {
    let finish = (_added: boolean) => {};
    const addLink = () => new Promise<boolean>((resolve) => { finish = resolve; });
    const { result } = renderHook(() => useSearch({ addLink, clearProblem: () => {} } as unknown as Adder));
    return { result, finish: (added: boolean) => act(async () => finish(added)) };
  };

  it('clears once its link is in', async () => {
    const { result, finish } = adding();
    act(() => result.current.setValue('https://example.com/one.mp4'));
    await act(async () => { void result.current.submit(); });
    await finish(true);
    expect(result.current.value).toBe('');
  });

  it('keeps what was typed while the last link went in', async () => {
    const { result, finish } = adding();
    act(() => result.current.setValue('https://example.com/one.mp4'));
    await act(async () => { void result.current.submit(); });
    act(() => result.current.setValue('https://example.com/two.mp4'));
    await finish(true);
    expect(result.current.value).toBe('https://example.com/two.mp4');
  });
});
