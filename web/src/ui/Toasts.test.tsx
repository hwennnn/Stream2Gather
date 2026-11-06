// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSession, RoomView } from '../room/session';
import { JumpToast } from './Toasts';

const view = (patch: Partial<RoomView> = {}) =>
  ({
    jump: { id: 'c', by: 'Asha', title: 'Video c' },
    self: { userId: 'me', name: 'Ada', role: 'member' },
    settings: { controlMode: 'everyone', queueMode: 'everyone' },
    offlineSince: null,
    ...patch,
  }) as RoomView;

const setup = (patch?: Partial<RoomView>, undoJump = vi.fn(async () => {})) => {
  const onToast = vi.fn();
  render(<JumpToast session={{ undoJump } as unknown as RoomSession} view={view(patch)} onToast={onToast} />);
  return { undoJump, onToast };
};

describe('JumpToast', () => {
  afterEach(cleanup);

  it('names who jumped and to what', () => {
    setup();
    expect(screen.getByText(/jumped to/).textContent).toBe('Asha jumped to Video c');
  });

  it('says you when it was you', () => {
    setup({ jump: { id: 'c', by: 'Ada', title: 'Video c' } });
    expect(screen.getByText(/jumped to/).textContent).toBe('You jumped to Video c');
  });

  it('undoes the jump it is showing', () => {
    const { undoJump } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undoJump).toHaveBeenCalledWith('c');
  });

  it('says so when the undo came too late', async () => {
    const { onToast } = setup(undefined, vi.fn(async () => Promise.reject(new Error('stale'))));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
    expect(onToast).toHaveBeenCalledWith('Too late to undo that.');
  });

  it('keeps the news but not the button from someone who can’t control playback', () => {
    setup({ settings: { controlMode: 'hosts', queueMode: 'hosts' } });
    expect(screen.getByText(/jumped to/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('shows nothing when there is nothing to undo', () => {
    setup({ jump: null });
    expect(screen.queryByText(/jumped to/)).toBeNull();
  });
});
