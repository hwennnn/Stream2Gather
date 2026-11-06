// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { QueuePanel } from './QueuePanel';
import { Thumb } from './Thumb';

vi.mock('./Thumb', () => ({ Thumb: vi.fn(() => null) }));

const item = (id: string) =>
  ({ id, title: `Video ${id}`, addedByName: 'Maya', durationMs: 0, source: 'direct', sourceId: id }) as unknown as QueueItem;

const view = (patch: Partial<RoomView> = {}) =>
  ({
    queue: [item('a'), item('b')],
    playback: { item: 'a', status: 'playing', pos: 0, at: 0, rate: 1 },
    settings: { controlMode: 'everyone', queueMode: 'everyone' },
    self: { userId: 'me', name: 'Ada', role: 'member' },
    offlineSince: null,
    ...patch,
  }) as RoomView;

const setup = (patch?: Partial<RoomView>) => {
  const session = { request: vi.fn(async () => {}), queueMove: vi.fn(async () => {}), queueRemove: vi.fn(async () => {}) };
  const { container } = render(<QueuePanel session={session as unknown as RoomSession} view={view(patch)} onToast={() => {}} />);
  return { session, rowTap: () => container.querySelector('.row-tap') };
};

describe('an empty room', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ items: [] })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('leaves search and trending to the stage', () => {
    setup({ queue: [] });
    expect(screen.queryByLabelText('Add a video')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Trending' })).toBeNull();
    expect(screen.getByText(/queue is empty/)).toBeTruthy();
  });

  it('keeps the add box once something is playing', () => {
    setup();
    expect(screen.getByLabelText('Add a video')).toBeTruthy();
  });
});

describe('tapping a queue row', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ items: [] })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the tray and changes nothing for the room', () => {
    const { session, rowTap } = setup();
    fireEvent.click(rowTap() as Element);
    expect(session.request).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('closes the tray on a second tap', () => {
    const { rowTap } = setup();
    fireEvent.click(rowTap() as Element);
    fireEvent.click(rowTap() as Element);
    expect(screen.queryByRole('button', { name: 'Play now' })).toBeNull();
  });

  it('plays only from the tray, on purpose', () => {
    const { session, rowTap } = setup();
    fireEvent.click(rowTap() as Element);
    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));
    expect(session.request).toHaveBeenCalledWith('queue.play', { target: 'b' });
  });

  it('gives a guest in a locked room nothing to tap', () => {
    const { rowTap } = setup({ settings: { controlMode: 'hosts', queueMode: 'hosts' } });
    expect(rowTap()).toBeNull();
  });
});

describe('a long queue', () => {
  const queue = Array.from({ length: 12 }, (_, n) => item(`v${n}`));
  const session = { request: vi.fn(async () => {}), queueMove: vi.fn(async () => {}), queueRemove: vi.fn(async () => {}) } as unknown as RoomSession;
  const onToast = () => {};
  const panel = (patch?: Partial<RoomView>) => <QueuePanel session={session} view={view({ queue, ...patch })} onToast={onToast} />;
  const drawn = () => vi.mocked(Thumb).mock.calls.length;

  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ items: [] })));
    vi.mocked(Thumb).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('leaves its rows alone while someone types in the box', () => {
    render(panel());
    const before = drawn();
    fireEvent.change(screen.getByLabelText('Add a video'), { target: { value: 'l' } });
    fireEvent.change(screen.getByLabelText('Add a video'), { target: { value: 'lo' } });
    // Now playing isn't a row, and it isn't worth a memo.
    expect(drawn() - before).toBeLessThanOrEqual(2);
  });

  it('leaves its rows alone when the room changes around them', () => {
    const { rerender } = render(panel());
    const before = drawn();
    rerender(panel({ viewerStates: { other: 'buffering' } }));
    expect(drawn() - before).toBeLessThanOrEqual(1);
  });

  it('still takes the row actions away when the room goes offline', () => {
    const { rerender } = render(panel());
    const remove = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Remove: Video v3' });
    expect(remove().disabled).toBe(false);
    rerender(panel({ offlineSince: 1 }));
    expect(remove().disabled).toBe(true);
  });

  it('acts on the row that was clicked, after the list has changed', () => {
    const { rerender } = render(panel());
    rerender(panel({ queue: [queue[0] as QueueItem, ...queue.slice(2)] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove: Video v3' }));
    expect(session.queueRemove).toHaveBeenCalledWith('v3');
  });
});
