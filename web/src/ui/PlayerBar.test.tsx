// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { MainAction, PlayerBar, UnmuteButton } from './PlayerStage';
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

const report = { health: 'ok' };

const bar = (view: RoomView) =>
  render(
    <PlayerBar
      {...({
        session: {} as RoomSession,
        view,
        item,
        player: { failure: { kind: 'embed_blocked' }, muted: false, reports: { get: () => report, subscribe: () => () => {} } },
        onToast: vi.fn(),
      } as unknown as ComponentProps<typeof PlayerBar>)}
    />,
  );

describe('PlayerBar when this viewer cannot play and someone else can', () => {
  it('keeps Skip for anyone allowed to control', () => {
    bar(viewFor('member', 'everyone'));
    expect(screen.getByRole('button', { name: 'Finish video' })).toBeTruthy();
  });

  it('keeps Skip for a blocked host, or a locked room has nobody left who can', () => {
    bar(viewFor('host', 'hosts'));
    expect(screen.getByRole('button', { name: 'Finish video' })).toBeTruthy();
  });

  it('gives no Skip to a guest the host has locked out', () => {
    bar(viewFor('member', 'hosts'));
    expect(screen.queryByRole('button', { name: 'Finish video' })).toBeNull();
  });
});

describe('MainAction', () => {
  const paused = (role: string, controlMode: string) => ({ ...viewFor(role, controlMode), offlineSince: null, playback: { item: 'a', status: 'paused', pos: 0, at: 0, rate: 1 } }) as unknown as RoomView;
  const shown = (view: RoomView, failure: unknown = null) => {
    render(<MainAction session={{} as RoomSession} view={view} player={{ muted: true, failure, refused: false } as unknown as RoomPlayer} onToast={vi.fn()} />);
    return { resume: screen.queryByRole('button', { name: 'Resume for everyone' }), unmute: screen.queryByRole('button', { name: 'Tap to unmute' }) };
  };

  it('offers Resume in any paused room, started or not, and no second primary', () => {
    const { resume, unmute } = shown(paused('member', 'everyone'));
    expect(resume).toBeTruthy();
    expect(unmute).toBeNull();
  });

  it('gives it only to someone who may use it', () => {
    expect(shown(paused('member', 'hosts')).resume).toBeNull();
  });

  it('never lets a viewer whose player failed start it for everyone else', () => {
    expect(shown(paused('member', 'everyone'), { kind: 'network' }).resume).toBeNull();
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
