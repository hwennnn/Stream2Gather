// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catchupApi } from './api';
import { Missed } from './Missed';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Missed', () => {
  it('offers each missed video by its link', async () => {
    vi.spyOn(catchupApi, 'missed').mockResolvedValue({
      items: [{ itemId: 9, startedAt: '2026-11-01T20:00:00Z', moments: 4, media: { title: 'Heat' } as never }],
    });

    render(<Missed slug="sundays" />);

    expect((await screen.findByRole('link', { name: 'You missed this. Catch up.' })).getAttribute('href')).toBe('/r/sundays/catchup/9');
    expect(screen.getByText('Heat')).toBeTruthy();
  });

  it('stays out of the way with nothing to offer', async () => {
    const missed = vi.spyOn(catchupApi, 'missed').mockResolvedValue({ items: [] });

    const { container } = render(<Missed slug="sundays" />);
    await vi.waitFor(() => expect(missed).toHaveBeenCalled());

    expect(container.textContent).toBe('');
  });
});
