import { useSyncExternalStore } from 'react';
import { api, type Account, type SiteConfig } from '../api/http';

/** The parts of Clerk's browser object this app calls. */
export type ClerkControls = {
  openSignIn: (options?: { forceRedirectUrl?: string; signUpForceRedirectUrl?: string }) => void;
  openUserProfile: () => void;
  signOut: () => Promise<unknown>;
};

type AccountView = {
  user: Account | null;
  publishableKey: string;
  /** Null until the server has answered. */
  config: SiteConfig | null;
  /** Clerk's script only loads for people who are signing in or signed in. */
  clerkWanted: boolean;
  problem: string | null;
  /** The server couldn't say how to sign in. A failed `/v1/me` isn't this: sign-in still works. */
  startFailed: boolean;
};

// Survives the redirect back from Google, which reloads the page.
const SIGNING_IN = 's2g:signing-in';

let view: AccountView = { user: null, publishableKey: '', config: null, clerkWanted: false, problem: null, startFailed: false };
let clerk: ClerkControls | null = null;
let openWhenReady = false;
/** The sign-in was opened by this page, so it may still be showing. */
let openedHere = false;
const listeners = new Set<() => void>();
const identityListeners = new Set<() => void>();

const update = (patch: Partial<AccountView>) => {
  view = { ...view, ...patch };
  for (const listener of listeners) listener();
};

const setUser = (user: Account | null) => {
  const changed = user?.id !== view.user?.id;
  update({ user, problem: null });
  if (changed) for (const listener of identityListeners) listener();
};

const open = () => {
  openedHere = true;
  const here = window.location.href;
  clerk?.openSignIn({ forceRedirectUrl: here, signUpForceRedirectUrl: here });
};

export const account = {
  current: () => view,

  /** One failure mustn't cost the other's answer: guests can watch either way. */
  async start(): Promise<void> {
    const [config, me] = await Promise.allSettled([api.config(), api.me()]);
    const user = me.status === 'fulfilled' ? me.value.user : view.user;
    update({
      user,
      clerkWanted: Boolean(user?.signedIn) || sessionStorage.getItem(SIGNING_IN) !== null,
      startFailed: config.status === 'rejected',
      ...(config.status === 'fulfilled' ? { publishableKey: config.value.clerkPublishableKey, config: config.value } : {}),
    });
  },

  /** A rename is the only way a first-time guest gets a session before joining. */
  async rename(name: string): Promise<void> {
    update({ user: (await api.rename(name)).user });
  },

  /** Keeps this store in step after the room session has renamed the viewer. */
  noteName(name: string): void {
    if (view.user) update({ user: { ...view.user, name } });
  },

  signIn(): void {
    sessionStorage.setItem(SIGNING_IN, '1');
    if (clerk) {
      open();
      return;
    }
    openWhenReady = true;
    update({ clerkWanted: true, problem: null });
  },

  manage(): void {
    clerk?.openUserProfile();
  },

  async signOut(): Promise<void> {
    await clerk?.signOut();
    setUser((await api.signOut()).user);
  },

  /** Called by the Clerk bridge once Clerk's script has loaded. */
  attach(controls: ClerkControls): void {
    clerk = controls;
    if (openWhenReady) {
      openWhenReady = false;
      open();
    }
  },

  async clerkSignedIn(getToken: () => Promise<string | null>): Promise<void> {
    try {
      const token = await getToken();
      if (!token) return;
      setUser((await api.clerkSession(token)).user);
      sessionStorage.removeItem(SIGNING_IN);
    } catch {
      update({ problem: 'We couldn’t finish signing you in. Try again.' });
    }
  },

  /**
   * Clerk says this on every load and right as a sign-in opens, so on its own it
   * settles nothing. Only a page that opened nothing itself knows the attempt
   * that set the flag is over: back from a redirect signed out, or reloaded after
   * closing the sign-in. A return that did sign in reports that instead.
   */
  async clerkSignedOut(): Promise<void> {
    if (!openWhenReady && !openedHere) sessionStorage.removeItem(SIGNING_IN);
    if (view.user?.signedIn) setUser((await api.signOut()).user);
  },

  clerkFailed(): void {
    openWhenReady = false;
    sessionStorage.removeItem(SIGNING_IN);
    update({ clerkWanted: false, problem: 'Sign-in is unavailable right now.' });
  },

  /** Runs when the person behind this browser changes, such as after signing in. */
  onIdentityChange(listener: () => void): () => void {
    identityListeners.add(listener);
    return () => identityListeners.delete(listener);
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAccount = () => useSyncExternalStore(subscribe, () => view);
