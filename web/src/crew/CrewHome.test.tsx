// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomPreview } from '../api/http';
import CrewHome from '../routes/CrewHome';
import { crewApi, type CrewDocument } from './api';

const accountState = vi.hoisted(() => ({ view: { user: null as unknown, publishableKey: 'pk', clerkWanted: false, problem: null } }));
const signIn = vi.hoisted(() => vi.fn());

vi.mock('../auth/account', () => ({ useAccount: () => accountState.view, account: { signIn } }));
vi.mock('../ui/usePageVisible', () => ({ usePageVisible: () => true }));

const preview = (crew: RoomPreview['crew']): RoomPreview => ({
  slug: 'movie-night',
  name: 'Movie Night',
  nowPlaying: null,
  playback: null,
  members: [],
  maxMembers: 50,
  crew,
});

const document = (roster: CrewDocument['roster']): CrewDocument => ({
  ...preview({ memberCount: roster.length, isMember: true, guestAccess: true }),
  ownerId: 'u1',
  inviteToken: 'tok',
  guestAccess: true,
  roster,
  watchlist: [],
});

const hana = { userId: 'u1', name: 'Hana', joinedAt: '2026-11-06T00:00:00Z' };
const mika = { userId: 'u2', name: 'Mika', joinedAt: '2026-11-06T00:00:00Z' };
const onJoin = vi.fn(async () => {});

const signIntoAccount = () => {
  accountState.view = { ...accountState.view, user: { id: 'u1', name: 'Hana', avatarUrl: '', signedIn: true } };
};

beforeEach(() => {
  accountState.view = { user: null, publishableKey: 'pk', clerkWanted: false, problem: null };
  sessionStorage.clear();
  window.history.replaceState(null, '', '/r/movie-night');
  vi.restoreAllMocks();
  onJoin.mockClear();
  signIn.mockClear();
  window.matchMedia = vi.fn(() => ({ matches: false })) as never;
});

afterEach(cleanup);

describe('CrewHome', () => {
  it('shows a member the room button and the invite', async () => {
    signIntoAccount();
    vi.spyOn(crewApi, 'home').mockResolvedValue(document([hana, mika]));
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 2, isMember: true, guestAccess: true })} onJoin={onJoin} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Join the room' }));
    expect(onJoin).toHaveBeenCalled();
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).toContain('/r/movie-night?join=tok');
    expect(screen.queryByText('It’s just you. Copy the invite.')).toBeNull();
  });

  it('tells the only member to invite someone', async () => {
    signIntoAccount();
    vi.spyOn(crewApi, 'home').mockResolvedValue(document([hana]));
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    expect(await screen.findByText('It’s just you. Copy the invite.')).toBeTruthy();
  });
});
