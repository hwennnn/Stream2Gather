// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { hueOf } from './people';
import { Seats, useSeats } from './Seats';

const ada = { userId: 'a', name: 'Ada', role: 'member' };
const bo = { userId: 'b', name: 'Bo', role: 'member' };
const view = { self: ada, members: [ada, bo], speaking: ['b'], viewerStates: {}, reactions: [], alone: false } as unknown as RoomView;
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
});
