// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useShownView } from './useShownView';

describe('a panel that may be hidden', () => {
  const run = (first: string) =>
    renderHook(({ value, shown }) => useShownView(value, shown), { initialProps: { value: first, shown: true } });

  it('follows the room while it is showing', () => {
    const { result, rerender } = run('a');
    rerender({ value: 'b', shown: true });
    expect(result.current).toBe('b');
  });

  it('keeps what it last showed while hidden', () => {
    const { result, rerender } = run('a');
    rerender({ value: 'b', shown: false });
    rerender({ value: 'c', shown: false });
    expect(result.current).toBe('a');
  });

  it('catches up in the same render it comes back', () => {
    const { result, rerender } = run('a');
    rerender({ value: 'b', shown: false });
    rerender({ value: 'c', shown: true });
    expect(result.current).toBe('c');
  });
});
