import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../api/http';

const FLAG = 's2g:signing-in';

const guest: Account = { id: 'g_1', name: 'Amber panda', avatarUrl: '', signedIn: false };
const ada: Account = { id: 'u_1', name: 'Ada', avatarUrl: 'https://img.clerk.com/a', signedIn: true };

/** One page load: a fresh copy of the module, and the storage a redirect keeps. */
const load = async (me: Account | null = guest) => {
  vi.resetModules();
  const { account } = await import('./account');
  responses.me = me;
  const controls = { openSignIn: vi.fn(), openUserProfile: vi.fn(), signOut: vi.fn(async () => {}) };
  const identityChanges = vi.fn();
  account.onIdentityChange(identityChanges);
  await account.start();
  /** What the bridge's effect does each time Clerk reports in, in its order. */
  const clerkReports = async (signedIn: boolean) => {
    account.attach(controls);
    if (signedIn) await account.clerkSignedIn(async () => 'token');
    else await account.clerkSignedOut();
  };
  return { account, controls, identityChanges, clerkReports };
};

let storage: Map<string, string>;
const responses: { me: Account | null; session: Account | null } = { me: null, session: null };
const signedOutCalls = vi.fn();

describe('account sign-in', () => {
  beforeEach(() => {
    storage = new Map();
    signedOutCalls.mockReset();
    responses.session = ada;
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('window', { location: { href: 'http://test/r/room' } });
    vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
      const body = (value: unknown) => new Response(JSON.stringify(value));
      if (path === '/v1/config') return body({ clerkPublishableKey: 'pk_test_x' });
      if (path === '/v1/me') return body({ user: responses.me });
      if (path === '/v1/session/clerk') return body({ user: responses.session });
      if (path === '/v1/session' && init?.method === 'DELETE') {
        signedOutCalls();
        return body({ user: null });
      }
      throw new Error(`unexpected ${path}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the flag through the first click, when Clerk loads and reports signed out', async () => {
    const { account, controls, clerkReports } = await load();
    account.signIn();
    await clerkReports(false);
    expect(controls.openSignIn).toHaveBeenCalledTimes(1);
    expect(storage.has(FLAG)).toBe(true);
  });

  it('keeps the flag however often Clerk repeats itself while the sign-in is open', async () => {
    const { account, clerkReports } = await load();
    account.signIn();
    await clerkReports(false);
    await clerkReports(false);
    expect(storage.has(FLAG)).toBe(true);
  });

  it('finishes after the redirect back from Google', async () => {
    const first = await load();
    first.account.signIn();
    await first.clerkReports(false);

    // Google sends the browser back: everything but sessionStorage starts over.
    const back = await load();
    await back.clerkReports(true);
    expect(storage.has(FLAG)).toBe(false);
    expect(back.controls.openSignIn).not.toHaveBeenCalled();
    expect(back.identityChanges).toHaveBeenCalledTimes(1);
  });

  it('asks for Clerk on the way back, or nothing would finish the sign-in', async () => {
    const first = await load();
    first.account.signIn();
    await first.clerkReports(false);

    const back = await load();
    expect(back.account.current().clerkWanted).toBe(true);
  });

  it('leaves guests without Clerk once the attempt is settled', async () => {
    const first = await load();
    first.account.signIn();
    await first.clerkReports(false);
    await (await load()).clerkReports(false);

    expect((await load()).account.current().clerkWanted).toBe(false);
  });

  it('survives Clerk saying signed out before it says signed in on the way back', async () => {
    const first = await load();
    first.account.signIn();
    await first.clerkReports(false);

    const back = await load();
    await back.clerkReports(false);
    await back.clerkReports(true);
    expect(back.identityChanges).toHaveBeenCalledTimes(1);
    expect(storage.has(FLAG)).toBe(false);
  });

  it('lets someone who closed the sign-in open it again, then forgets it on reload', async () => {
    const page = await load();
    page.account.signIn();
    await page.clerkReports(false);

    // Clerk gives no sign the modal closed. It just stays signed out.
    page.account.signIn();
    expect(page.controls.openSignIn).toHaveBeenCalledTimes(2);

    const reload = await load();
    await reload.clerkReports(false);
    expect(reload.controls.openSignIn).not.toHaveBeenCalled();
    expect(storage.has(FLAG)).toBe(false);
  });

  it('forgets an attempt that came back signed out', async () => {
    const first = await load();
    first.account.signIn();
    await first.clerkReports(false);

    const back = await load();
    await back.clerkReports(false);
    expect(storage.has(FLAG)).toBe(false);
    expect(signedOutCalls).not.toHaveBeenCalled(); // A guest has nothing to sign out of.
  });

  it('opens at once when Clerk is already here', async () => {
    const { account, controls, clerkReports } = await load();
    await clerkReports(false);
    account.signIn();
    expect(controls.openSignIn).toHaveBeenCalledTimes(1);
    await clerkReports(false);
    expect(storage.has(FLAG)).toBe(true);
  });

  it('rejoins the room when the account has a new id', async () => {
    const { identityChanges, clerkReports } = await load();
    await clerkReports(true);
    expect(identityChanges).toHaveBeenCalledTimes(1);
  });

  it('does not rejoin for a returning account that is already this viewer', async () => {
    const { identityChanges, clerkReports } = await load(ada);
    await clerkReports(true);
    expect(identityChanges).not.toHaveBeenCalled();
  });

  it('signs out of this app when Clerk no longer knows the viewer', async () => {
    const { identityChanges, clerkReports } = await load(ada);
    await clerkReports(false);
    expect(signedOutCalls).toHaveBeenCalledTimes(1);
    expect(identityChanges).toHaveBeenCalledTimes(1);
  });
});
