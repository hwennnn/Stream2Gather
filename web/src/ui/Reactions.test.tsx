// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import roomPage from '../routes/RoomPage.tsx?raw';
import playerStage from './PlayerStage.tsx?raw';
import { ReactionLane, ReactionTicker } from './Reactions';

const reactions = [
  { id: 1, emoji: '🔥', name: 'Golden Otter' },
  { id: 2, emoji: '😂', name: 'Maya' },
  { id: 3, emoji: '❤️', name: 'Sam' },
  { id: 4, emoji: '👏', name: 'Pia' },
];

describe('reactions', () => {
  afterEach(cleanup);

  it('says who reacted, by first name, so a long one fits the lane', () => {
    render(<ReactionLane reactions={reactions.slice(0, 2)} />);
    expect(screen.getByText('Golden')).toBeTruthy();
    expect(screen.getByText('Maya')).toBeTruthy();
  });

  it('gives each reaction a burst of its own', () => {
    const { container } = render(<ReactionLane reactions={reactions.slice(0, 1)} />);
    expect(container.querySelectorAll('.reaction-spark').length).toBeGreaterThan(2);
  });

  it('keeps theatre mode to the last few', () => {
    render(<ReactionTicker reactions={reactions} />);
    expect(screen.queryByText('Golden')).toBeNull();
    expect(screen.getByText('Pia')).toBeTruthy();
  });

  it('is rendered by the rail, and only the ticker by the bar', () => {
    expect(playerStage).not.toMatch(/<ReactionLane/);
    expect(roomPage).toMatch(/<ReactionLane/);
  });
});
