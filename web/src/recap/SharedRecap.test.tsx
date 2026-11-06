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
        { title: 'Heat', url: 'https://youtu.be/a', reactions: 2 },
        { title: '', url: '', reactions: 0 },
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

  it('says a revoked link is gone', async () => {
    vi.spyOn(recapApi, 'shared').mockRejectedValue(new Error('404'));

    render(<SharedRecap token="t" />);

    expect(await screen.findByText('This recap isn’t shared')).toBeTruthy();
  });
});
