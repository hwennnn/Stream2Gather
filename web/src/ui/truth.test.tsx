// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The flows run the same check in the browser, and they're plain JavaScript.
import { disagreements } from '../../../e2e/lib/truth.mjs';
import type { QueueItem, RoomView } from '../room/session';
import type { SyncHealth } from '../sync/controller';
import { FailurePanel } from './PlayerStage';
import { statusFor, type Part, type Status } from './status';

const me = { userId: 'me', name: 'Ada', role: 'member' };
const maya = { userId: 'm', name: 'Maya', role: 'host' };
const item = { source: 'youtube', url: 'https://youtu.be/a', title: 'A video', id: 'a' } as QueueItem;

const words = (parts: Part[]) => parts.map((part) => (typeof part === 'string' ? part : 'who' in part ? part.who : part.fig)).join('');
const sentence = ({ parts, tail = '' }: Status) => words(parts) + tail;

afterEach(cleanup);

const each = <T,>(values: T[]) => values;

describe('every status surface', () => {
  const cases = each<'playing' | 'paused'>(['playing', 'paused']).flatMap((status) =>
    each([null, 2000, 31_000]).flatMap((offlineFor) =>
      each([false, true]).flatMap((failed) =>
        each<SyncHealth>(['synced', 'correcting', 'buffering', 'waiting', 'stalled']).flatMap((health) =>
          each([undefined, 'buffering', 'stalled', 'unavailable']).flatMap((friend) =>
            each([true, false]).flatMap((here) => each([true, false]).map((started) => ({ status, offlineFor, failed, health, friend, here, started }))),
          ),
        ),
      ),
    ),
  );

  it(`agrees in all ${cases.length} states a room can be in`, () => {
    const found = cases.flatMap(({ status, offlineFor, failed, health, friend, here, started }) => {
      const view = {
        self: me,
        members: here ? [me, maya] : [me],
        alone: !here,
        viewerStates: friend ? { m: friend } : {},
        queue: [item],
        settings: { controlMode: 'everyone', queueMode: 'everyone' },
        playback: { status, pausedBy: 'Maya', pausedById: 'm' },
      } as unknown as RoomView;
      const shown = statusFor({ view, health, failed, act: null, position: 200, started, slow: true, gap: true, friendGap: true, offlineFor });
      const panel = failed ? render(<FailurePanel item={item} error={{ kind: 'embed_blocked', code: 150 }} view={view} onPickAnother={() => {}} onRetry={() => {}} />) : null;
      const surfaces = [
        // What the room is really doing, because a line can be wrong with nothing beside it to disagree.
        { name: 'room', text: status === 'paused' ? 'paused' : '' },
        { name: 'line', text: sentence(shown), state: shown.state },
        { name: 'sideways', text: words(shown.parts), state: shown.state },
        { name: 'panel', text: panel?.container.textContent ?? '' },
      ];
      panel?.unmount();
      return disagreements(surfaces).map((clash: string) => `${status}/${String(offlineFor)}/${health}: ${clash}`);
    });
    expect(found).toEqual([]);
  });
});

describe('the check itself', () => {
  it.each([
    ['Paused by Maya at 3:20', 'Loading…'],
    ['Paused by Maya at 3:20', 'Reconnecting. The video keeps playing.'],
    ['Paused by Maya at 3:20', 'It’s just you. Maya is still watching.'],
    ['Playing at 3:25, everyone together', 'It’s just you. Maya is still watching.'],
    ['Resume for everyone, Skip', 'Playing at 3:25, everyone together'],
  ])('catches “%s” beside “%s”', (first, second) => {
    expect(disagreements([{ name: 'a', text: first }, { name: 'b', text: second }])).not.toEqual([]);
  });

  it('catches two lines in different states', () => {
    expect(disagreements([{ name: 'a', text: 'x', state: 'paused' }, { name: 'b', text: 'y', state: 'playing' }])).not.toEqual([]);
  });

  it('leaves true statements alone', () => {
    expect(disagreements([{ name: 'a', text: 'Reconnecting. Your video stays paused.' }, { name: 'b', text: '' }])).toEqual([]);
  });
});
