// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../room/session';
import { Whisper } from './Whisper';

const said = (id: string, userId: string, body: string, patch = {}): ChatEntry => ({ kind: 'chat', id, userId, author: 'Maya Patel', body, createdAt: '2026-11-06T00:00:00Z', ...patch }) as ChatEntry;

describe('Whisper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says nothing about what was said before theatre mode', () => {
    render(<Whisper messages={[said('1', 'm', 'old news')]} selfId="me" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('passes on what a friend says, by first name, and lets it go', () => {
    const { rerender } = render(<Whisper messages={[]} selfId="me" />);
    rerender(<Whisper messages={[said('1', 'm', 'wait for it')]} selfId="me" />);
    expect(screen.getByRole('status').textContent).toBe('Mayawait for it');
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('doesn’t repeat what you said, or what you missed', () => {
    const { rerender } = render(<Whisper messages={[]} selfId="me" />);
    rerender(<Whisper messages={[said('1', 'me', 'hello')]} selfId="me" />);
    rerender(<Whisper messages={[said('1', 'me', 'hello'), said('2', 'm', 'spoiler', { missed: true })]} selfId="me" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
