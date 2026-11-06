// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerError } from '../players/types';
import type { QueueItem, RoomView } from '../room/session';
import { FailurePanel } from './PlayerStage';

const item = { source: 'youtube', url: 'https://www.youtube.com/watch?v=abc', title: 'A video' } as QueueItem;
const refused: PlayerError = { kind: 'embed_blocked', code: 150 };
const member = (userId: string, name: string) => ({ userId, name });
const solo = { self: { userId: 'me' }, members: [member('me', 'Me')], viewerStates: {}, alone: true, playback: { status: 'playing' }, settings: { controlMode: 'everyone', queueMode: 'everyone' } } as unknown as RoomView;
const withAFriend = { ...solo, members: [member('me', 'Me'), member('ada', 'Ada Byron')], alone: false } as RoomView;

const panel = (view: RoomView, error = refused) => {
  const onRetry = vi.fn();
  render(<FailurePanel item={item} error={error} view={view} onPickAnother={() => {}} onRetry={onRetry} />);
  return onRetry;
};

afterEach(cleanup);

describe('the failure panel', () => {
  it.each([
    ['alone', solo],
    ['while a friend keeps watching', withAFriend],
  ])('retries the player rather than the page, %s', (_, view) => {
    const onRetry = panel(view);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('blames nobody for a refusal it can’t explain', () => {
    panel(solo);
    expect(document.body.textContent).not.toMatch(/owner/i);
  });

  it('says a friend is watching only while the room plays', () => {
    panel({ ...withAFriend, playback: { status: 'playing' } } as RoomView);
    expect(document.body.textContent).toMatch(/Ada is still watching/);
    cleanup();
    panel({ ...withAFriend, playback: { status: 'paused' } } as RoomView);
    expect(document.body.textContent).toMatch(/Ada can play it/);
    expect(document.body.textContent).not.toMatch(/watching/);
  });

  it('promises no skip when the page’s address is what YouTube refused', () => {
    panel(solo, { ...refused, kind: 'ip_origin' });
    expect(document.body.textContent).not.toMatch(/Skipping/);
  });
});
