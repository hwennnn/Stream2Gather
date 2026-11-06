import { describe, expect, it } from 'vitest';
import { routeFor } from './router';

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
