// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { PlayerBar, UnmuteButton } from './PlayerStage';
import type { RoomPlayer } from './useRoomPlayer';

afterEach(cleanup);

const item = { id: 'a', title: 'A video', source: 'youtube', url: 'https://youtu.be/a' } as QueueItem;

const viewFor = (role: string, controlMode: string) =>
  ({
    self: { userId: 'me', name: 'Me', role },
    members: [
      { userId: 'me', name: 'Me', role },
      { userId: 'them', name: 'Them', role: role === 'host' ? 'member' : 'host' },
    ],
    viewerStates: { me: 'unavailable' },
    settings: { controlMode, queueMode: 'everyone' },
    playback: { item: 'a', status: 'playing', pos: 0, at: 0, rate: 1 },
    queue: [item],
    reactions: [],
    connection: 'live',
  }) as unknown as RoomView;

const bar = (view: RoomView) =>
  render(
    <PlayerBar
      {...({
        session: {} as RoomSession,
        view,
        item,
        player: { failure: { kind: 'embed_blocked' }, cold: false, muted: false, report: { health: 'ok' } },
        onToast: vi.fn(),
      } as unknown as ComponentProps<typeof PlayerBar>)}
    />,
  );

describe('PlayerBar when this viewer cannot play and someone else can', () => {
  it('keeps Skip for anyone allowed to control', () => {
    bar(viewFor('member', 'everyone'));
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
  });

  it('keeps Skip for a blocked host, or a locked room has nobody left who can', () => {
    bar(viewFor('host', 'hosts'));
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
  });

  it('gives no Skip to a guest the host has locked out', () => {
    bar(viewFor('member', 'hosts'));
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
  });
});

describe('UnmuteButton', () => {
  const shown = (refused: boolean) => {
    render(<UnmuteButton player={{ muted: true, failure: null, refused } as unknown as RoomPlayer} />);
    return screen.queryByRole('button', { name: 'Tap to unmute' }) !== null;
  };

  it('offers sound for a video that is playing silently', () => {
    expect(shown(false)).toBe(true);
  });

  it('stays out of the way while the viewer still has to press play', () => {
    expect(shown(true)).toBe(false);
  });
});
