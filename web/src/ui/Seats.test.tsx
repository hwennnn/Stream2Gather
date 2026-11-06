// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomView } from '../room/session';
import { Seats } from './Seats';

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
});
