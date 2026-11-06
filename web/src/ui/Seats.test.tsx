// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { hueOf } from './people';
import { Seats, useSeats } from './Seats';

const ada = { userId: 'a', name: 'Ada', role: 'member' as const };
const bo = { userId: 'b', name: 'Bo', role: 'member' as const };
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

  it('puts a reaction at the sender’s shoulder, with their face still showing', () => {
    const reactions = [{ id: 7, emoji: '🔥', name: 'Bo', userId: 'b' }];
    render(<Seats view={{ ...view, reactions }} row={row} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    const seat = screen.getByText('Bo').closest('li');
    expect(seat?.querySelector('.seat-said')?.textContent).toBe('🔥');
    expect(seat?.textContent).toContain('B');
    expect(seat?.getAttribute('data-hop')).toBe('1');
    expect(screen.getByText('You').closest('li')?.querySelector('.seat-said')).toBeNull();
  });

  it('tells two people with one name apart', () => {
    const twin = { ...bo, userId: 'c' };
    const both = [...(row as unknown as unknown[]), { person: twin, here: true }] as never;
    const reactions = [{ id: 7, emoji: '🔥', name: 'Bo', userId: 'c' }];
    render(<Seats view={{ ...view, members: [ada, bo, twin], reactions }} row={both} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    expect(document.querySelectorAll('.seat-said')).toHaveLength(1);
    expect(screen.getAllByText('Bo')[1]?.closest('li')?.querySelector('.seat-said')).toBeTruthy();
  });

  it('gives the count the reaction of someone with no seat', () => {
    const crowd = Array.from({ length: 12 }, (_, index) => ({ userId: `p${index}`, name: `P${index}`, role: 'member' as const }));
    const full = crowd.slice(0, 8).map((person) => ({ person, here: true })) as never;
    const reactions = [{ id: 7, emoji: '😂', name: 'P11', userId: 'p11' }];
    render(<Seats view={{ ...view, members: crowd, reactions } as unknown as RoomView} row={full} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByRole('button', { name: '4 more people' }).querySelector('.seat-said')?.textContent).toBe('😂');
  });

  it('starts a beat at the seat it belongs to, and counts the others from there', () => {
    const three = [...(row as unknown as unknown[]), { person: { ...bo, userId: 'c', name: 'Cy' }, here: true }] as never;
    render(<Seats view={view} row={three} actor={null} beat={{ kind: 'hold', from: ['a'] }} onInvite={() => {}} onPeople={() => {}} />);
    const cy = screen.getByText('Cy').closest('li');
    expect(screen.getByRole('list', { name: 'In the room' }).getAttribute('data-beat')).toBe('hold');
    expect(screen.getByText('You').closest('li')?.getAttribute('data-origin')).toBe('true');
    expect(cy?.getAttribute('data-origin')).toBe('false');
    expect(cy?.style.getPropertyValue('--dist')).toBe('2');
    expect(cy?.style.getPropertyValue('--toward')).toBe('-1');
  });

  it('keeps everyone looking at whoever got up, long after the beat is over', () => {
    const paused = { ...view, playback: { status: 'paused', pausedBy: 'Bo', pausedById: 'b' } } as unknown as RoomView;
    render(<Seats view={paused} row={row} actor="Bo" onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByText('You').closest('li')?.style.getPropertyValue('--toward')).toBe('1');
    expect(screen.getByText('Bo').closest('li')?.style.getPropertyValue('--toward')).toBe('0');
  });

  it('keeps a seat for someone who stepped out, and says so to a screen reader', () => {
    const left = [{ person: ada, here: true }, { person: bo, here: false }] as never;
    render(<Seats view={{ ...view, members: [ada] }} row={left} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByText('Bo').closest('li')?.getAttribute('data-away')).toBe('true');
    expect(screen.getByText('Bo').closest('li')?.textContent).toContain(', stepped out');
  });

  it('offers an empty seat, and holds it once the link is out', () => {
    const { rerender } = render(<Seats view={view} row={row} actor={null} onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByRole('button', { name: 'Invite' }).textContent).toContain('Save a seat');
    rerender(<Seats view={view} row={row} actor={null} saved onInvite={() => {}} onPeople={() => {}} />);
    expect(screen.getByRole('button', { name: 'Invite' }).textContent).toContain('Seat saved');
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
