// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { hueOf } from './people';
import { Seats, useSeats } from './Seats';

const ada = { userId: 'a', name: 'Ada', role: 'member' };
const bo = { userId: 'b', name: 'Bo', role: 'member' };
const view = { self: ada, members: [ada, bo], speaking: ['b'], viewerStates: {}, reactions: [], alone: false, playback: { status: 'playing' } } as unknown as RoomView;
const row = [
  { person: ada, here: true },
  { person: bo, here: true },
] as never;

describe('Seats', () => {
  afterEach(cleanup);

  it('shows who is talking on their own seat', () => {
    render(<Seats view={view} row={row} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByText('Bo').closest('li')?.getAttribute('data-speaking')).toBe('true');
    expect(screen.getByText('You').closest('li')?.getAttribute('data-speaking')).toBe('false');
  });

  it('leaves a person their own colour whoever else is in the room', () => {
    const twins = Array.from({ length: 200 }, (_, index) => `twin-${index}`);
    const [first = '', second = ''] = twins.filter((id) => hueOf(id) === hueOf(twins[0]));
    const alone = hueOf(second);
    const members = [first, second].map((userId) => ({ userId, name: userId, role: 'member' }));
    renderHook(() => useSeats({ ...view, members, vacated: [] } as unknown as RoomView));
    expect(hueOf(second)).toBe(alone);
  });

  it.each([
    ['buffering', 'catching up'],
    ['stalled', 'at an ad'],
    ['unavailable', 'can’t play'],
  ])('keeps a friend’s name while they’re %s', (status, words) => {
    render(<Seats view={{ ...view, viewerStates: { b: status } }} row={row} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    const seat = screen.getByText('Bo').closest('li');
    expect(seat?.getAttribute('data-trouble')).toBe('true');
    expect(seat?.textContent).toContain(`, ${words}`);
    expect(seat?.getAttribute('title')).toBe(`Bo, ${words}`);
  });

  it.each(['buffering', 'correcting', 'stalled'])('puts no ring on someone reporting %s in a paused room', (status) => {
    render(<Seats view={{ ...view, viewerStates: { b: status }, playback: { status: 'paused' } } as unknown as RoomView} row={row} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    const seat = screen.getByText('Bo').closest('li');
    expect(seat?.getAttribute('data-trouble')).toBe('false');
    expect(seat?.getAttribute('title')).toBe('Bo');
  });

  it('still says who can’t play in a paused room', () => {
    render(<Seats view={{ ...view, viewerStates: { b: 'unavailable' }, playback: { status: 'paused' } } as unknown as RoomView} row={row} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByText('Bo').closest('li')?.getAttribute('data-trouble')).toBe('true');
  });

  it('still offers Invite when a full row has people standing', () => {
    const crowd = Array.from({ length: 28 }, (_, index) => ({ userId: `p${index}`, name: `P${index}`, role: 'member' }));
    const packed = { ...view, members: crowd } as unknown as RoomView;
    const full = crowd.slice(0, 8).map((person) => ({ person, here: true })) as never;
    render(<Seats view={packed} row={full} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByRole('button', { name: '20 more people' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
  });
});
