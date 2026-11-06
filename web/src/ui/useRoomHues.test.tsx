// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { hueOf } from './people';
import { useRoomHues } from './useRoomHues';

const Room = ({ ids }: { ids: string[] }) => {
  useRoomHues('room', ids.map((userId) => ({ userId })));
  return <p>{ids.map((id) => hueOf(id)).join(' ')}</p>;
};

const crowd = Array.from({ length: 8 }, (_, index) => `guest-${index}`);

describe('useRoomHues', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('colours the seats in the same pass that draws them', () => {
    const { container } = render(<Room ids={crowd} />);
    expect(new Set(container.textContent?.split(' ')).size).toBe(crowd.length);
  });

  it('survives a reload, even when the people who shaped it have gone', () => {
    const first = render(<Room ids={crowd} />);
    const hues = first.container.textContent?.split(' ') ?? [];
    first.unmount();
    const reloaded = render(<Room ids={crowd.slice(-2)} />);
    expect(reloaded.container.textContent?.split(' ')).toEqual(hues.slice(-2));
  });

  it('hands back everyone’s usual colour when the room closes', () => {
    const usual = hueOf('guest-1');
    render(<Room ids={crowd} />).unmount();
    expect(hueOf('guest-1')).toBe(usual);
  });
});
