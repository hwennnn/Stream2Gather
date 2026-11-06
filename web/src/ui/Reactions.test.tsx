// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../room/session';
import roomPage from '../routes/RoomPage.tsx?raw';
import { addToWake, markEmoji, markSize, SeatTrack } from './SeatTrack';

const reaction = (id: number, emoji = '😂') => ({ id, emoji, name: 'Maya', userId: 'm' });

const view = (patch: Partial<RoomView> = {}) =>
  ({
    members: [{ userId: 'm', name: 'Maya', role: 'member' }],
    viewerStates: {},
    viewerDrift: {},
    reactions: [],
    lastAction: null,
    playback: { item: 'a', status: 'playing', pos: 10, at: Date.now(), rate: 1 },
    ...patch,
  }) as unknown as RoomView;

describe('the wake', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('makes one moment of reactions that land together, in the emoji most people sent', () => {
    const marks = addToWake([], [reaction(1, '🔥'), reaction(2), reaction(3)], 1000);
    expect(marks).toHaveLength(1);
    expect(marks.map(markEmoji)).toEqual(['😂']);
    expect(marks.map(markSize)).toEqual([3]);
  });

  it('starts a new moment once the last has passed', () => {
    const first = addToWake([], [reaction(1)], 1000);
    expect(addToWake(first, [reaction(2)], 4000)).toHaveLength(2);
  });

  it('stops growing, and stops keeping old marks, so a long laugh costs nothing', () => {
    const loud = addToWake([], Array.from({ length: 40 }, (_, index) => reaction(index)), 1000);
    expect(loud.map(markSize)).toEqual([6]);
    const many = Array.from({ length: 40 }, (_, index) => index).reduce((marks, index) => addToWake(marks, [reaction(index)], index * 2000), loud);
    expect(many).toHaveLength(24);
  });

  it('drops a reaction on the track and holds it there while the room is paused', () => {
    const { container, rerender } = render(<SeatTrack view={view()} />);
    rerender(<SeatTrack view={view({ reactions: [reaction(1)] })} />);
    expect(container.querySelector('.wake-mark')?.textContent).toBe('😂');
    expect(container.querySelector('.seat-track')?.getAttribute('data-moving')).toBe('true');
    rerender(<SeatTrack view={view({ reactions: [reaction(1)], playback: { item: 'a', status: 'paused', pos: 10, at: 0, rate: 1 } })} />);
    expect(container.querySelector('.seat-track')?.getAttribute('data-moving')).toBe('false');
    expect(container.querySelector('.wake-mark')).toBeTruthy();
  });

  it('forgets the wake when the room jumps, as those moments aren’t behind it any more', () => {
    const { container, rerender } = render(<SeatTrack view={view()} />);
    rerender(<SeatTrack view={view({ reactions: [reaction(1)] })} />);
    rerender(<SeatTrack view={view({ reactions: [reaction(1)], lastAction: { by: 'Maya', cause: 'seek' } })} />);
    expect(container.querySelector('.wake-mark')).toBeNull();
  });

  it('forgets it with the video too', () => {
    const { container, rerender } = render(<SeatTrack view={view()} />);
    rerender(<SeatTrack view={view({ reactions: [reaction(1)] })} />);
    rerender(<SeatTrack view={view({ reactions: [reaction(1)], playback: { item: 'b', status: 'playing', pos: 0, at: Date.now(), rate: 1 } })} />);
    expect(container.querySelector('.wake-mark')).toBeNull();
  });

  it('leaves the rail to the people talking in it', () => {
    expect(roomPage).not.toMatch(/ReactionLane/);
  });
});
