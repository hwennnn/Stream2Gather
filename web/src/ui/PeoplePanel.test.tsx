// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomSession, RoomView } from '../room/session';
import { PeoplePanel } from './PeoplePanel';

const self = { userId: 'me', name: 'A name long enough to run out of room in the rail', role: 'member' as const };

describe('PeoplePanel', () => {
  afterEach(cleanup);

  it('truncates the name and never "(you)"', () => {
    const view = { self, members: [self], speaking: [], viewerStates: {}, settings: { controlMode: 'everyone', queueMode: 'everyone' }, offlineSince: null } as unknown as RoomView;
    render(<PeoplePanel session={{} as RoomSession} view={view} onToast={() => {}} />);
    const you = screen.getByText('(you)');
    expect(you.className).toMatch(/shrink-0/);
    expect(you.closest('.truncate')).toBeNull();
    expect(screen.getByText(self.name).className).toMatch(/truncate/);
  });

  it('says who is talking, over how they joined', () => {
    const listener = { ...self, voice: 'listening' };
    const view = { self: listener, members: [listener], speaking: ['me'], viewerStates: {}, settings: { controlMode: 'everyone', queueMode: 'everyone' } } as unknown as RoomView;
    render(<PeoplePanel session={{} as RoomSession} view={view} onToast={() => {}} />);
    expect(screen.getByText('Speaking')).toBeDefined();
    expect(screen.queryByText('Listening')).toBeNull();
  });
});
