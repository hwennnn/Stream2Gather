import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/http';
import { routeFor, startRoom } from './router';

describe('routeFor', () => {
  it.each([
    ['/', { page: 'landing' }],
    ['/r/', { page: 'landing' }],
    ['/s/', { page: 'landing' }],
    ['/about', { page: 'landing' }],
    ['/r/abc', { page: 'room', slug: 'abc' }],
    ['/r/abc/', { page: 'room', slug: 'abc' }],
    ['/r/abc/catchup', { page: 'room', slug: 'abc' }],
    ['/r/abc/catchup/12', { page: 'catchup', slug: 'abc', itemId: '12' }],
    ['/s/token', { page: 'recap', token: 'token' }],
  ])('%s', (path, route) => {
    expect(routeFor(path)).toEqual(route);
  });
});

describe('startRoom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('walks in without touching the clipboard, which holds something of theirs', async () => {
    const writeText = vi.fn(async () => {});
    const pushState = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', {
      location: { origin: 'http://test' },
      history: { pushState },
      dispatchEvent: () => true,
    });
    vi.stubGlobal('PopStateEvent', class {});
    vi.spyOn(api, 'createRoom').mockResolvedValue({ slug: 'room', name: 'Room' });

    await startRoom();

    expect(writeText).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledWith({ joined: true }, '', '/r/room');
  });
});
