// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomSession, RoomView } from '../room/session';
import { PeoplePanel } from './PeoplePanel';

const self = { userId: 'me', name: 'A name long enough to run out of room in the rail', role: 'member' as const };

describe('PeoplePanel', () => {
  afterEach(cleanup);

  it('truncates the name and never "(you)"', () => {
    const view = { self, members: [self], speaking: [], viewerStates: {}, playback: { status: 'playing' }, settings: { controlMode: 'everyone', queueMode: 'everyone' }, offlineSince: null } as unknown as RoomView;
    render(<PeoplePanel session={{} as RoomSession} view={view} onToast={() => {}} />);
    const you = screen.getByText('(you)');
    expect(you.className).toMatch(/shrink-0/);
    expect(you.closest('.truncate')).toBeNull();
    expect(screen.getByText(self.name).className).toMatch(/truncate/);
  });

  it('says who is talking, over how they joined', () => {
    const listener = { ...self, voice: 'listening' };
    const view = { self: listener, members: [listener], speaking: ['me'], viewerStates: {}, playback: { status: 'playing' }, settings: { controlMode: 'everyone', queueMode: 'everyone' } } as unknown as RoomView;
    render(<PeoplePanel session={{} as RoomSession} view={view} onToast={() => {}} />);
    expect(screen.getByText('Speaking')).toBeDefined();
    expect(screen.queryByText('Listening')).toBeNull();
  });

  describe('each row', () => {
    const people = [
      { userId: 'a', name: 'Bea', role: 'member' },
      { userId: 'h', name: 'Neon', role: 'host' },
      { userId: 'me', name: 'Solar', role: 'member' },
    ];
    const show = (viewerStates = {}, self = people[2]) =>
      render(
        <PeoplePanel
          session={{} as RoomSession}
          view={{ self, members: people, viewerStates, playback: { status: 'playing' }, speaking: [], settings: { controlMode: 'everyone', queueMode: 'everyone' } } as unknown as RoomView}
          onToast={() => {}}
        />,
      );
    const rows = () => screen.getAllByRole('listitem').map((row) => row.textContent ?? '');

    it('puts you first, then the host, however the server ordered them', () => {
      show();
      expect(rows().map((row) => people.find(({ name }) => row.includes(name))?.name)).toEqual(['Solar', 'Neon', 'Bea']);
    });

    it('still says who is the host when they have a status too', () => {
      show({ h: 'unavailable' });
      const host = rows().find((row) => row.includes('Neon')) ?? '';
      expect(host).toContain('Host');
      expect(host).toContain('Can’t play this video');
    });

    it('says nobody is catching up in a paused room', () => {
      render(
        <PeoplePanel
          session={{} as RoomSession}
          view={{ self: people[2], members: people, viewerStates: { a: 'correcting' }, playback: { status: 'paused' }, speaking: [], settings: { controlMode: 'everyone', queueMode: 'everyone' } } as unknown as RoomView}
          onToast={() => {}}
        />,
      );
      expect(screen.queryByText('Catching up')).toBeNull();
    });

    it('marks you, even when you are the host', () => {
      show({}, people[1]);
      expect(rows()[0]).toContain('(you)');
      expect(rows()[0]).toContain('Host');
    });
  });
});
