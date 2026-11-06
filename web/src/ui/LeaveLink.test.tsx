// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSession } from '../room/session';
import { LeaveLink } from './LeaveLink';

afterEach(cleanup);

const setup = (leave = vi.fn(() => Promise.resolve())) => {
  const go = vi.fn();
  render(
    <LeaveLink session={{ leave } as unknown as RoomSession} go={go}>
      Leave
    </LeaveLink>,
  );
  return { leave, go, link: screen.getByRole('link', { name: 'Leave' }) };
};

describe('LeaveLink', () => {
  it('leaves the room first, then goes home', async () => {
    let finish = () => {};
    const { go, link } = setup(vi.fn(() => new Promise<void>((resolve) => (finish = resolve))));
    fireEvent.click(link);
    expect(go).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/'));
  });

  it('leaves a new-tab click alone, because the room stays open here', () => {
    const { leave, link } = setup();
    fireEvent.click(link, { metaKey: true });
    expect(leave).not.toHaveBeenCalled();
  });
});
