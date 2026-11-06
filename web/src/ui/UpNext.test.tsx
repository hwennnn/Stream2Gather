// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { planStrip, standingThumbHeight, UpNext } from './UpNext';

describe('planStrip', () => {
  it('leaves no video unaccounted for, at any size', () => {
    for (const total of [1, 2, 3, 4, 7, 40]) {
      for (const width of [300, 596, 900, 1012, 1400]) {
        for (const height of [90, 112, 150, 252]) {
          const { shown, more } = planStrip(total, width, height);
          expect(shown + more).toBe(total);
          expect(shown).toBeGreaterThan(0);
        }
      }
    }
  });

  it('shows every card when they fit, with no tile', () => {
    expect(planStrip(3, 1012, 112)).toMatchObject({ shown: 3, more: 0 });
  });

  it('gives up a card to make room for the tile', () => {
    expect(planStrip(4, 800, 112)).toMatchObject({ shown: 3, more: 1 });
    expect(planStrip(10, 800, 112)).toMatchObject({ shown: 3, more: 7 });
  });

  it('stands the cards up when height is what there is', () => {
    expect(planStrip(4, 596, 252)).toMatchObject({ stacked: true, shown: 2, more: 2 });
    expect(standingThumbHeight(planStrip(4, 596, 400), 596)).toBeCloseTo(131.6, 0);
  });
});

const item = (id: string) => ({ id, title: `Video ${id}`, addedByName: 'Maya' }) as unknown as QueueItem;

describe('UpNext', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly report: () => void) {}
      observe() {
        this.report();
      }
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(668);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(112);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('counts what doesn’t fit, and opens the queue for it', () => {
    const onShowQueue = vi.fn();
    const view = {
      queue: ['a', 'b', 'c', 'd', 'e'].map(item),
      settings: { controlMode: 'everyone', queueMode: 'everyone' },
      offlineSince: null,
    } as unknown as RoomView;
    render(<UpNext session={{} as RoomSession} view={view} onPickAnother={() => {}} onShowQueue={onShowQueue} onToast={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '2 more in the queue' }));
    expect(onShowQueue).toHaveBeenCalled();
  });
});
