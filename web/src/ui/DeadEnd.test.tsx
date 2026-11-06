// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closedRoom, DeadEnd, ENDINGS, fullRoom } from './DeadEnd';

vi.mock('../routes/router', () => ({ startRoom: vi.fn() }));

afterEach(cleanup);

const member = (index: number) => ({ userId: `u${index}`, name: `Person ${index}`, role: 'member' as const });

describe('DeadEnd', () => {
  it('sends someone on a page that doesn’t exist home, and nowhere else', () => {
    render(<DeadEnd {...ENDINGS.page} home />);
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('button', { name: 'Start a new room' })).toBeNull();
  });

  it('shows a full room its seats, names the host, and offers no new room', () => {
    const people = [{ userId: 'h', name: 'Maya Lin', role: 'host' as const }, ...Array.from({ length: 49 }, (_, index) => member(index))];
    render(<DeadEnd {...fullRoom(people)} />);
    expect(screen.getByRole('list', { name: 'Seats' }).textContent).toContain('+46');
    expect(screen.getByText('Every seat is taken. Ask Maya to open another room.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for a seat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start a new room' })).toBeNull();
  });

  it('says who was in a closed room, when this browser knows', () => {
    render(<DeadEnd {...closedRoom([{ userId: 'a', name: 'Maya Lin' }, { userId: 'b', name: '김민지' }])} />);
    expect(screen.getByText('Maya and 김민지 were here. Start a new one and send the link round.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Seats' }).querySelector('[data-away="true"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a new room' })).toBeTruthy();
  });

  it('keeps the closed room plain when it does not', () => {
    expect(closedRoom([])).toBe(ENDINGS.closed);
  });

  it('dims the lights when there is nothing on the screen', () => {
    render(<DeadEnd {...ENDINGS.page} home />);

    expect(document.querySelector('.door-screen .dark-room')).not.toBeNull();
    expect(document.querySelector('.door-screen img')).toBeNull();
  });

  it('offers only Try again when the room cannot be reached, and no seats', () => {
    render(<DeadEnd {...ENDINGS.unreachable} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start a new room' })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
