// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomPage } from './RoomPage';

vi.mock('../api/http', async (actual) => ({
  ...(await actual<typeof import('../api/http')>()),
  api: { preview: async () => ({ name: 'Room', members: [], maxMembers: 10 }) },
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
  },
}));

describe('RoomPage', () => {
  beforeEach(() => window.history.replaceState(null, ''));
  afterEach(cleanup);

  it('shows the gate to someone who has not joined', async () => {
    render(<RoomPage slug="room" />);
    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('skips the gate on a reload', () => {
    window.history.replaceState({ joined: true }, '');
    render(<RoomPage slug="room" />);
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
  });
});
