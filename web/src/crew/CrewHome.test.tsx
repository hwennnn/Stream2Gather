// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type RoomPreview } from '../api/http';
import CrewHome from '../routes/CrewHome';
import { recapApi } from '../recap/api';
import { crewApi, type CrewDocument, type WatchItem } from './api';

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
  vi.restoreAllMocks();
  vi.spyOn(crewApi, 'sessions').mockResolvedValue({ items: [] });
  accountState.view = { user: null, publishableKey: 'pk', clerkWanted: false, problem: null };
  sessionStorage.clear();
  window.history.replaceState(null, '', '/r/movie-night');
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

    fireEvent.click(await screen.findByRole('button', { name: 'Be the first in' }));
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

  it('saves an invited friend a seat, with one Join, and says what they get', () => {
    window.history.replaceState(null, '', '/r/movie-night?join=tok');
    const crew = { memberCount: 3, isMember: false, guestAccess: true };
    render(<CrewHome slug="movie-night" preview={{ ...preview(crew), members: [{ userId: 'u9', name: 'Maya Lin', role: 'host' }] }} onJoin={onJoin} />);

    expect(screen.getByRole('heading', { name: 'Maya saved you a seat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take your seat' }).className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: 'Join the crew' }).className).not.toContain('btn');
    expect(screen.getByText(/You can watch, chat and react tonight/)).toBeTruthy();
    expect(window.document.body.textContent).not.toMatch(/guest/i);
    fireEvent.click(screen.getByRole('button', { name: 'Join the crew' }));
    expect(signIn).toHaveBeenCalled();
  });

  it('joins with the token and strips it from the address', async () => {
    signIntoAccount();
    window.history.replaceState(null, '', '/r/movie-night?join=tok');
    const home = vi.spyOn(crewApi, 'home').mockRejectedValueOnce(new ApiError(403, 'not_member', 'no'));
    const join = vi.spyOn(crewApi, 'join').mockResolvedValue({});
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: false, guestAccess: true })} onJoin={onJoin} />);

    home.mockResolvedValue(document([hana, mika]));
    fireEvent.click(await screen.findByRole('button', { name: 'Join the crew' }));

    await screen.findByRole('button', { name: 'Be the first in' });
    expect(join).toHaveBeenCalledWith('movie-night', 'tok');
    expect(window.location.search).toBe('');
  });

  it('says so when the invite has been rotated, and keeps Join', async () => {
    signIntoAccount();
    window.history.replaceState(null, '', '/r/movie-night?join=old');
    vi.spyOn(crewApi, 'home').mockRejectedValue(new ApiError(403, 'not_member', 'no'));
    vi.spyOn(crewApi, 'join').mockRejectedValue(new ApiError(403, 'invalid_invite', 'This invite link has expired. Ask for a new one.'));
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: false, guestAccess: true })} onJoin={onJoin} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Join the crew' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This invite link has expired. Ask for a new one.');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Join the crew' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Take your seat' })).toBeTruthy();
  });

  it('gives an invited friend one button when the crew is members only', () => {
    window.history.replaceState(null, '', '/r/movie-night?join=tok');
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: false, guestAccess: false })} onJoin={onJoin} />);
    expect(screen.getByRole('button', { name: 'Join the crew' }).className).toContain('btn-primary');
    expect(screen.queryByRole('button', { name: 'Take your seat' })).toBeNull();
  });

  it('shuts a members-only room to anyone without an invite', () => {
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: false, guestAccess: false })} onJoin={onJoin} />);
    expect(screen.queryByRole('button', { name: 'Take your seat' })).toBeNull();
    expect(screen.getByText('This room is for its crew. Ask them for an invite.')).toBeTruthy();
  });

  it('says a video is unavailable when its details are gone, and never guesses a title', async () => {
    signIntoAccount();
    const watchlist = [{ id: 7, source: 'youtube', sourceId: 'abc', addedAt: '2026-11-06T00:00:00Z', addedBy: null, media: null }];
    vi.spyOn(crewApi, 'home').mockResolvedValue({ ...document([hana]), watchlist });
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    expect(await screen.findByText('Video unavailable')).toBeTruthy();
    expect(screen.queryByText('abc')).toBeNull();
    expect(screen.queryByText('Add something for next time.')).toBeNull();
  });

  it('gives the owner settings and asks before closing, and gives a member only Leave', async () => {
    signIntoAccount();
    vi.spyOn(crewApi, 'home').mockResolvedValue(document([hana, mika]));
    const close = vi.spyOn(crewApi, 'close').mockResolvedValue({});
    const owner = render(<CrewHome slug="movie-night" preview={preview({ memberCount: 2, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Members and settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close it for everyone?' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith('movie-night'));
    owner.unmount();

    accountState.view = { ...accountState.view, user: { id: 'u2', name: 'Mika', avatarUrl: '', signedIn: true } };
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 2, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Members and settings' }));
    expect(await screen.findByRole('button', { name: 'Leave' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Hana' })).toBeNull();
  });

  it('keeps Remove and Make owner behind a row menu, and asks first', async () => {
    signIntoAccount();
    vi.spyOn(crewApi, 'home').mockResolvedValue(document([hana, mika]));
    const removeMember = vi.spyOn(crewApi, 'removeMember').mockResolvedValue({});
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 2, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Members and settings' }));
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make owner' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Mika' }));
    expect(screen.getByRole('button', { name: 'Make owner' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removeMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mika?' }));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('movie-night', 'u2'));
  });

  it('shows the link only when the clipboard refuses it', async () => {
    signIntoAccount();
    vi.spyOn(crewApi, 'home').mockResolvedValue(document([hana, mika]));
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 2, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    const field = await screen.findByLabelText('Invite link');
    expect(field.className).toBe('sr-only');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(field.className).toContain('field'));
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('credits a friend for what they added, but not you for your own', async () => {
    signIntoAccount();
    const row = (id: number, sourceId: string, addedBy: WatchItem['addedBy']): WatchItem => ({
      id,
      source: 'youtube',
      sourceId,
      addedAt: '2026-11-06T00:00:00Z',
      addedBy,
      media: { source: 'youtube', sourceId, url: 'https://a.test', title: `Title ${sourceId}`, author: 'A channel', thumbnailUrl: '', durationMs: 0, isLive: false },
    });
    const watchlist = [row(1, 'friend', { userId: 'u_mika', name: 'Mika Tan' }), row(2, 'mine', { userId: 'u1', name: 'Hana' }), row(3, 'gone', null)];
    vi.spyOn(crewApi, 'home').mockResolvedValue({ ...document([hana]), watchlist });
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: true, guestAccess: true })} onJoin={vi.fn()} />);
    expect(await screen.findByText('Added by Mika')).toBeTruthy();
    expect(screen.getAllByText(/^Added by/)).toHaveLength(1);
  });

  it('gives a face its person\'s colour, and a former member none', async () => {
    signIntoAccount();
    vi.spyOn(crewApi, 'home').mockResolvedValue(document([hana]));
    vi.spyOn(recapApi, 'read').mockRejectedValue(new Error('offline'));
    vi.spyOn(crewApi, 'sessions').mockResolvedValue({
      items: [
        {
          id: 's',
          startedAt: '2026-11-01T20:00:00Z',
          endedAt: '2026-11-01T21:30:00Z',
          people: [{ userId: 'u_mika', name: 'Mika', isGuest: false }, { name: 'Former member', isGuest: false }],
          videos: [],
        },
      ],
    });
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: true, guestAccess: true })} onJoin={vi.fn()} />);
    await screen.findByRole('list', { name: 'Past nights' });
    const face = (name: string) => window.document.querySelector<HTMLElement>(`[title="${name}"]`);
    expect(face('Mika')?.style.backgroundColor).not.toBe('');
    expect(face('Former member')?.style.backgroundColor).toBe('');
  });

  it('lists past sessions with fresh titles, and says when there are none', async () => {
    signIntoAccount();
    vi.spyOn(crewApi, 'home').mockResolvedValue(document([hana]));
    const empty = render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    expect(await screen.findByText('Your first night together will show up here.')).toBeTruthy();
    empty.unmount();

    vi.spyOn(recapApi, 'read').mockRejectedValue(new Error('offline'));
    vi.spyOn(crewApi, 'sessions').mockResolvedValue({
      items: [
        {
          id: 's',
          startedAt: '2026-11-01T20:00:00Z',
          endedAt: '2026-11-01T21:30:00Z',
          people: [{ name: 'Hana', isGuest: false }],
          videos: [{ source: 'youtube', media: null }, { source: 'youtube', media: null }],
        },
      ],
    });
    render(<CrewHome slug="movie-night" preview={preview({ memberCount: 1, isMember: true, guestAccess: true })} onJoin={onJoin} />);
    expect((await screen.findByRole('list', { name: 'Past nights' })).textContent).toContain('Video unavailable + 1 more');
    expect(screen.getByRole('list', { name: 'Past nights' }).textContent).toContain('1 h 30 min');
    expect(screen.getByText('Reactions and watch stats come from Stream2Gather, not YouTube.')).toBeTruthy();
  });
});
