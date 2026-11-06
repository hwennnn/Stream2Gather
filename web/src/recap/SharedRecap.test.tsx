// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recapApi } from './api';
import SharedRecap from './SharedRecap';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SharedRecap', () => {
  it('links out to the video instead of embedding it', async () => {
    vi.spyOn(recapApi, 'shared').mockResolvedValue({
      crewName: 'Movie Night',
      startedAt: '2026-11-01T20:00:00Z',
      wallMs: 3_600_000,
      people: ['Hana', 'Mika'],
      videos: [
        { title: 'Heat', url: 'https://youtu.be/a', reactions: 2, dots: [] },
        { title: '', url: '', reactions: 0, dots: [] },
      ],
      reactions: { '🔥': 2 },
      biggest: null,
    });

    render(<SharedRecap token="t" />);

    expect((await screen.findByRole('link', { name: 'Heat' })).getAttribute('href')).toBe('https://youtu.be/a');
    expect(screen.getByText('Video unavailable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start your own room' })).toBeTruthy();
    expect(screen.getByText('Reactions and watch stats come from Stream2Gather, not YouTube.')).toBeTruthy();
    expect(document.querySelector('iframe, video')).toBeNull();
  });

  it('draws the night as seats and dots, and no seat says who it is', async () => {
    vi.spyOn(recapApi, 'shared').mockResolvedValue({
      crewName: 'Movie Night',
      startedAt: '2026-11-01T20:00:00Z',
      wallMs: 3_600_000,
      people: ['Hana Kim', 'Mika', 'Sam'],
      videos: [
        { title: 'Heat', url: 'https://youtu.be/a', thumbnailUrl: 'https://i.ytimg.com/vi/a/hqdefault.jpg', reactions: 2, dots: [{ at: 50, seat: 1 }, { at: 75, seat: -1 }] },
        { title: 'No picture', url: 'https://example.com/b.mp4', reactions: 0, dots: [] },
      ],
      reactions: { '🔥': 2 },
      biggest: { title: 'Heat', posMs: 30_000, emojis: { '🔥': 2 }, people: 2, video: 0, at: 50 },
    });

    render(<SharedRecap token="t" />);

    const row = await screen.findByRole('img', { name: '3 seats taken, and one free' });
    expect(row.querySelectorAll('.poster-seat')).toHaveLength(4);
    expect(row.textContent).toBe('');
    expect(document.querySelector('.reel-still img')?.getAttribute('src')).toContain('i.ytimg.com');
    expect(screen.getByText('No picture')).toBeTruthy();
    const dots = [...document.querySelectorAll<HTMLElement>('.seat-track-dot')];
    expect(dots.map((dot) => dot.style.left)).toEqual(['50%', '75%']);
    expect(dots[0]?.style.backgroundColor).not.toBe('');
    expect(document.querySelector('.reel-best')?.textContent).toBe('🔥');
    expect(screen.getByText('Reactions and watch stats come from Stream2Gather, not YouTube.')).toBeTruthy();
  });

  it('says a revoked link is gone', async () => {
    vi.spyOn(recapApi, 'shared').mockRejectedValue(new Error('404'));

    render(<SharedRecap token="t" />);

    expect(await screen.findByText('This recap isn’t shared')).toBeTruthy();
  });
});
