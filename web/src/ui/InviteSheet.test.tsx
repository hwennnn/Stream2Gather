// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../room/session';
import { InviteSheet } from './InviteSheet';

afterEach(cleanup);

const view = { self: { name: 'Neon Lantern' }, name: 'Room', queue: [] } as unknown as RoomView;

describe('InviteSheet', () => {
  it('answers on the button, so nothing lands on top of the link', () => {
    render(<InviteSheet view={view} url="http://test/r/room" copied onCopy={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('says the card is a preview, so your own name on it reads as what friends get', () => {
    render(<InviteSheet view={view} url="http://test/r/room" copied={false} onCopy={vi.fn()} />);
    expect(screen.getByText('What friends will see')).toBeTruthy();
  });

  it('offers to copy until then', () => {
    render(<InviteSheet view={view} url="http://test/r/room" copied={false} onCopy={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });
});
