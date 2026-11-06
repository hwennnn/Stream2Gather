// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomPage } from './RoomPage';

const room = vi.hoisted(() => ({ signedOut: () => {}, identityChanged: vi.fn() }));

vi.mock('../api/http', async (actual) => ({
  ...(await actual<typeof import('../api/http')>()),
  api: {
    preview: async () => ({ name: 'Room', members: [], maxMembers: 10 }),
    me: async () => ({ user: { id: 'g_9', name: 'Velvet Cinema', avatarUrl: '', signedIn: false } }),
  },
}));
vi.mock('../ui/JoinGate', () => ({
  JoinGate: ({ onJoin }: { onJoin: (name: string, changed: boolean) => void }) => (
    <button type="button" onClick={() => onJoin('Ada', false)}>
      Join
    </button>
  ),
}));
vi.mock('../room/session', () => ({
  RoomSession: class {
    view = { connection: 'connecting' };
    subscribe = () => () => {};
    getView = () => this.view;
    connect = async () => {};
    close = () => {};
    followPage = () => () => {};
    identityChanged = room.identityChanged;
    onSignedOut = (listener: () => void) => {
      room.signedOut = listener;
      return () => {};
    };
  },
}));

describe('RoomPage', () => {
  beforeEach(() => window.history.replaceState(null, ''));
  afterEach(cleanup);

  it('remembers a guest has joined, so a reload goes straight back in', async () => {
    render(<RoomPage slug="room" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    expect(window.history.state).toMatchObject({ joined: true });
  });

  it('shows the gate to someone who has not joined', async () => {
    render(<RoomPage slug="room" />);
    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('asks who this browser is after the server ends its session, and tells the room', async () => {
    window.history.replaceState({ joined: true }, '');
    render(<RoomPage slug="room" />);

    room.signedOut();

    await waitFor(() => expect(room.identityChanged).toHaveBeenCalledWith('g_9'));
  });

  it('skips the gate on a reload', () => {
    window.history.replaceState({ joined: true }, '');
    render(<RoomPage slug="room" />);
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
  });
});
