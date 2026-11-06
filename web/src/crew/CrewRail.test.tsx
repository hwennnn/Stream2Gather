// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import * as http from '../api/http';
import CrewRail from './CrewRail';

const state = vi.hoisted(() => ({ view: {} as { user: unknown; publishableKey: string } }));
const signIn = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../auth/account', () => ({ useAccount: () => state.view, account: { signIn } }));
vi.mock('../routes/router', () => ({ navigate }));

const account = { id: 'u1', name: 'Hana', avatarUrl: '', signedIn: true };

beforeEach(() => {
  state.view = { user: account, publishableKey: 'pk' };
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn.mockClear();
  navigate.mockClear();
});

afterEach(cleanup);

describe('CrewRail', () => {
  it('lists crews with who is there', async () => {
    vi.spyOn(http, 'request').mockResolvedValue({
      items: [
        { slug: 'a', name: 'Movie night', here: 3 },
        { slug: 'b', name: 'Sundays', here: 0 },
      ],
    });
    render(<CrewRail />);
    expect((await screen.findByRole('link', { name: /Movie night/ })).getAttribute('href')).toBe('/r/a');
    expect(screen.getByText('3 here')).toBeTruthy();
    expect(screen.getByText('Nobody’s here')).toBeTruthy();
  });

  it('shows no list without crews, and starts one in the page', async () => {
    vi.spyOn(http, 'request').mockResolvedValue({ items: [] });
    const create = vi.spyOn(http, 'post').mockResolvedValue({ slug: 'new-crew', name: 'Sundays', inviteToken: 't' });
    render(<CrewRail />);
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start a crew' }));
    fireEvent.change(screen.getByLabelText('Crew name'), { target: { value: 'Sundays' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/r/new-crew'));
    expect(create).toHaveBeenCalledWith('/v1/crews', { name: 'Sundays' });
  });

  it('says why a crew could not start, and keeps the name', async () => {
    vi.spyOn(http, 'request').mockResolvedValue({ items: [] });
    vi.spyOn(http, 'post').mockRejectedValue(new ApiError(409, 'crew_limit', 'You can have up to 10 crews.'));
    render(<CrewRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a crew' }));
    fireEvent.change(screen.getByLabelText('Crew name'), { target: { value: 'Eleven' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect((await screen.findByRole('alert')).textContent).toBe('You can have up to 10 crews.');
    expect((screen.getByLabelText('Crew name') as HTMLInputElement).value).toBe('Eleven');
  });

  it('sends a guest to sign in first, then picks up where they were', async () => {
    state.view = { user: null, publishableKey: 'pk' };
    const { rerender } = render(<CrewRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a crew' }));
    expect(signIn).toHaveBeenCalled();

    vi.spyOn(http, 'request').mockResolvedValue({ items: [] });
    state.view = { user: account, publishableKey: 'pk' };
    rerender(<CrewRail />);
    expect(await screen.findByLabelText('Crew name')).toBeTruthy();
  });

  it('stays out of the way where nobody can sign in', () => {
    state.view = { user: null, publishableKey: '' };
    render(<CrewRail />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
