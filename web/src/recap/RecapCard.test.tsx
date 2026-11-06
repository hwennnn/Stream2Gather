// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recapApi, type Recap } from './api';
import { RecapCard } from './RecapCard';

const video = { source: 'youtube', sourceId: 'a', reactions: 4, media: { title: 'Heat' } as never };

const recap = (change: Partial<Recap> = {}): Recap => ({
  sessionId: 's1',
  startedAt: '2026-11-01T20:00:00Z',
  wallMs: 4_200_000,
  people: [
    { name: 'Hana', isGuest: false },
    { name: 'Mika', isGuest: true },
  ],
  items: [video, { ...video, sourceId: 'b', media: null }],
  reactions: { '🔥': 3, '😂': 1 },
  biggest: { posMs: 724_000, emojis: { '🔥': 3 }, people: 2, media: video.media, itemId: 9 },
  attended: true,
  ...change,
});

const show = (read: Recap) => {
  vi.spyOn(recapApi, 'read').mockResolvedValue(read);
  render(<RecapCard slug="movie-night" sessionId="s1" />);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RecapCard', () => {
  it('says who came, for how long, what played and the biggest moment', async () => {
    show(recap());

    expect(await screen.findByText('Hana, Mika')).toBeTruthy();
    expect(screen.getByText('1 h 10 min')).toBeTruthy();
    expect(screen.getByText('Video unavailable')).toBeTruthy();
    expect(screen.getByText('4 reactions')).toBeTruthy();
    expect(screen.getByText('12:04')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Relive it' }).getAttribute('href')).toBe('/r/movie-night/catchup/9?at=714000');
  });

  it('is plain about a quiet evening', async () => {
    show(recap({ biggest: null, reactions: {} }));

    expect((await screen.findByLabelText('Recap')).textContent).toContain('A quiet one. 2 videos, 1 h 10 min together.');
    expect(screen.queryByText('Relive it')).toBeNull();
  });

  it('offers no way back to a video that can no longer play', async () => {
    show(recap({ biggest: { posMs: 1000, emojis: { '🔥': 3 }, people: 2, media: null } }));

    expect((await screen.findByLabelText('Recap')).textContent).toContain('in Video unavailable');
    expect(screen.queryByText('Relive it')).toBeNull();
  });

  it('says so while it builds', async () => {
    show(recap({ building: true }));

    expect(await screen.findByText('Your recap is on its way.')).toBeTruthy();
  });

  it('shares and takes it back, for those who were there', async () => {
    const share = vi.spyOn(recapApi, 'share').mockResolvedValueOnce({ url: 'http://x/s/abc' }).mockResolvedValueOnce({});
    show(recap());

    fireEvent.click(await screen.findByRole('button', { name: 'Share this recap' }));
    expect(((await screen.findByLabelText('Recap link')) as HTMLInputElement).value).toBe('http://x/s/abc');

    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await screen.findByRole('button', { name: 'Share this recap' });
    expect(share).toHaveBeenLastCalledWith('movie-night', 's1', false);
  });

  it('keeps sharing to people who came', async () => {
    show(recap({ attended: false }));

    await screen.findByLabelText('Recap');
    expect(screen.queryByRole('button', { name: 'Share this recap' })).toBeNull();
  });
});
