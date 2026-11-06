// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type RoomPreview } from '../api/http';
import type { RoomSession, RoomView } from '../room/session';
import { crewApi, WANTS_JOIN } from './api';
import KeepRoom from './KeepRoom';

const accountState = vi.hoisted(() => ({ view: { user: null as unknown, publishableKey: 'pk' } }));
const signIn = vi.hoisted(() => vi.fn());
vi.mock('../auth/account', () => ({ useAccount: () => accountState.view, account: { signIn } }));

type Crew = (changed: 'settings', invite?: string) => void;

const fakeSession = () => {
  const listeners = new Set<Crew>();
  const session = {
    slug: 'movie-night',
    onCrew: (listener: Crew) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RoomSession;
  return { session, promoted: (invite: string) => act(() => listeners.forEach((listener) => listener('settings', invite))) };
};

const person = (role: 'host' | 'member', member = false) => ({ userId: 'me', name: 'Hana', role, member });
const viewAs = (role: 'host' | 'member', member = false) => ({ self: person(role), members: [person(role, member)] }) as unknown as RoomView;
const roomIs = (crew: RoomPreview['crew']) => vi.spyOn(api, 'preview').mockResolvedValue({ crew } as RoomPreview);
const signedIn = () => {
  accountState.view = { user: { id: 'me', signedIn: true }, publishableKey: 'pk' };
};

beforeEach(() => {
  accountState.view = { user: null, publishableKey: 'pk' };
  sessionStorage.clear();
  window.history.replaceState(null, '', '/r/movie-night');
  vi.restoreAllMocks();
  signIn.mockClear();
});

afterEach(cleanup);

describe('KeepRoom', () => {
  it('lets the host of a temporary room keep it, and nobody else', async () => {
    signedIn();
    roomIs(undefined);
    const promote = vi.spyOn(crewApi, 'promote').mockResolvedValue({ inviteToken: 't' });
    const { session } = fakeSession();

    const other = render(<KeepRoom session={session} view={viewAs('member')} />);
    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
    other.unmount();

    render(<KeepRoom session={session} view={viewAs('host')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep this room' }));
    await waitFor(() => expect(promote).toHaveBeenCalledWith('movie-night'));
  });

  it('signs a guest host in first, then keeps the room without asking again', async () => {
    roomIs(undefined);
    const promote = vi.spyOn(crewApi, 'promote').mockResolvedValue({ inviteToken: 't' });
    const { session } = fakeSession();

    const first = render(<KeepRoom session={session} view={viewAs('host')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep this room' }));
    expect(signIn).toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
    first.unmount();

    signedIn();
    render(<KeepRoom session={session} view={viewAs('host')} />);
    await waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
  });

  it('offers the crew to those present when the room becomes one', async () => {
    signedIn();
    roomIs(undefined);
    const join = vi.spyOn(crewApi, 'join').mockResolvedValue({});
    const { session, promoted } = fakeSession();

    render(<KeepRoom session={session} view={viewAs('member')} />);
    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    promoted('tok');

    fireEvent.click(await screen.findByRole('button', { name: /now a crew.*Join to keep it/ }));
    await waitFor(() => expect(join).toHaveBeenCalledWith('movie-night', 'tok'));
  });

  it('keeps a guest’s place in the crew through sign-in', async () => {
    roomIs(undefined);
    const { session, promoted } = fakeSession();

    render(<KeepRoom session={session} view={viewAs('member')} />);
    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    promoted('tok');
    fireEvent.click(await screen.findByRole('button', { name: /Join to keep it/ }));

    expect(signIn).toHaveBeenCalled();
    expect(sessionStorage.getItem(WANTS_JOIN)).toBe('movie-night');
    expect(window.location.search).toBe('?join=tok');
  });

  it('shows members the way home, and hides everything without any way to sign in', async () => {
    signedIn();
    roomIs({ memberCount: 2, isMember: true, guestAccess: true });
    const { session } = fakeSession();
    const member = render(<KeepRoom session={session} view={viewAs('member', true)} />);
    expect((await screen.findByRole('link', { name: 'Crew home' })).getAttribute('href')).toBe('/r/movie-night');
    member.unmount();

    accountState.view = { user: null, publishableKey: '' };
    roomIs(undefined);
    render(<KeepRoom session={session} view={viewAs('host')} />);
    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button')).toBeNull();
  });
});
