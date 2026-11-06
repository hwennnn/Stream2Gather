import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/http';
import { account, useAccount } from '../auth/account';
import type { RoomSession, RoomView } from '../room/session';
import { isHost, onCrew } from '../ui/rules';
import { crewApi, WANTS_JOIN } from './api';

/** Survives the redirect back from sign-in, which can reload the page. */
const WANTS_KEEP = 's2g:keep-room';

const tokenInUrl = () => new URLSearchParams(window.location.search).get('join');

/** The room header's crew action: keep a temporary room, join one, or go to its home. */
export default function KeepRoom({ session, view }: { session: RoomSession; view: RoomView }) {
  const { user, publishableKey } = useAccount();
  const signedIn = Boolean(user?.signedIn);
  const canSignIn = signedIn || publishableKey !== '';
  const { slug } = session;
  const host = isHost(view);
  const member = onCrew(view);
  const [crew, setCrew] = useState<boolean | null>(null);
  const [token, setToken] = useState(tokenInUrl);
  const [justKept, setJustKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.preview(slug).then(
      (preview) => live && setCrew((known) => known ?? Boolean(preview.crew)),
      () => {}, // The room carries on as it is.
    );
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(
    () =>
      session.onCrew((_, invite) => {
        if (!invite) return;
        setCrew(true);
        setToken(invite);
        setJustKept(true);
      }),
    [session],
  );

  const run = useCallback(async (step: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await step();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const keep = useCallback(
    () =>
      run(async () => {
        await crewApi.promote(slug);
        setCrew(true);
      }),
    [run, slug],
  );

  const join = useCallback(
    (invite: string) =>
      run(async () => {
        await crewApi.join(slug, invite);
        window.history.replaceState(window.history.state, '', window.location.pathname);
      }),
    [run, slug],
  );

  // Someone who had to sign in first carries on without asking twice.
  useEffect(() => {
    if (!signedIn) return;
    if (host && sessionStorage.getItem(WANTS_KEEP) === slug) {
      sessionStorage.removeItem(WANTS_KEEP);
      void keep();
    }
    if (token && sessionStorage.getItem(WANTS_JOIN) === slug) {
      sessionStorage.removeItem(WANTS_JOIN);
      void join(token);
    }
  }, [host, join, keep, signedIn, slug, token]);

  if (crew === null || !canSignIn) return null;

  if (crew && member) {
    return (
      <a href={`/r/${slug}`} className="btn btn-ghost btn-sm phone:hidden land:hidden">
        Crew home
      </a>
    );
  }

  if (crew && token) {
    const start = () => {
      if (signedIn) {
        void join(token);
        return;
      }
      sessionStorage.setItem(WANTS_JOIN, slug);
      window.history.replaceState(window.history.state, '', `${window.location.pathname}?join=${token}`);
      account.signIn();
    };
    return (
      <button type="button" disabled={busy} onClick={start} className="btn btn-ghost btn-sm">
        {justKept && <span className="phone:hidden">This room is now a crew. </span>}
        {failed ? 'That didn’t work. Try again.' : justKept ? 'Join to keep it.' : 'Join the crew'}
      </button>
    );
  }

  if (crew || !host) return null;

  const start = () => {
    if (signedIn) {
      void keep();
      return;
    }
    sessionStorage.setItem(WANTS_KEEP, slug);
    account.signIn();
  };
  return (
    <button type="button" disabled={busy} onClick={start} className="btn btn-quiet btn-sm">
      {failed ? 'Try again' : 'Keep this room'}
    </button>
  );
}
