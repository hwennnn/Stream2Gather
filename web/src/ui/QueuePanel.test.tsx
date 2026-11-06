// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { QueuePanel } from './QueuePanel';

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
