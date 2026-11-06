// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { account, useAccount } from '../auth/account';
import { AccountMenu } from './AccountMenu';

vi.mock('../auth/account', () => ({
  account: { start: vi.fn(async () => {}), signIn: vi.fn() },
  useAccount: vi.fn(),
}));

const shows = (patch: object) =>
  vi.mocked(useAccount).mockReturnValue({ user: null, publishableKey: '', problem: null, startFailed: false, ...patch } as unknown as ReturnType<typeof useAccount>);

describe('AccountMenu', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('offers a way back when it could not learn how to sign in', () => {
    shows({ startFailed: true });
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry sign-in' }));
    expect(account.start).toHaveBeenCalled();
  });

  it('offers sign-in when the server only couldn’t say who this is', () => {
    shows({ publishableKey: 'pk_test_x' });
    render(<AccountMenu />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('says when it could not confirm the other devices are out', () => {
    shows({ publishableKey: 'pk_test_x', othersMayRemain: true });
    render(<AccountMenu />);
    expect(screen.getByRole('status').textContent).toMatch(/other devices/);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('stays out of the way on a server with no sign-in', () => {
    shows({});
    render(<AccountMenu />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
