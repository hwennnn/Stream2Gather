import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, post, request } from '../api/http';
import { account, useAccount } from '../auth/account';
import { navigate } from '../routes/router';
import type { CrewLine } from './api';

// Both calls live here, not in crew/api: a module shared with the room page costs first-load JS.
const myCrews = () => request<{ items: CrewLine[] }>('/v1/me/crews');
const startCrew = (name: string) => post<{ slug: string }>('/v1/crews', { name });

const POLL_MS = 30_000;
/** Survives the redirect back from sign-in, which reloads the page. */
const WANTS_CREW = 's2g:start-crew';

const hereLine = (here: number) => (here === 0 ? 'Nobody’s here' : `${here} here`);

const StartCrew = ({ onCancel }: { onCancel: () => void }) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const crew = await startCrew(name.trim());
      navigate(`/r/${crew.slug}`);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'That didn’t work. Try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 flex max-w-md flex-wrap gap-2">
      <label htmlFor="crew-name" className="sr-only">
        Crew name
      </label>
      <input
        ref={input}
        id="crew-name"
        value={name}
        maxLength={32}
        onChange={(event) => setName(event.target.value)}
        placeholder="Movie night"
        autoComplete="off"
        className="field min-w-0 flex-1"
      />
      <button type="submit" disabled={busy || !name.trim()} className="btn btn-primary">
        {busy ? 'Starting…' : 'Start'}
      </button>
      <button type="button" onClick={onCancel} className="btn btn-quiet">
        Cancel
      </button>
      {problem && (
        <p role="alert" className="w-full text-sm text-warn">
          {problem}
        </p>
      )}
    </form>
  );
};

/** The landing page's way back into a crew, and into starting one. */
export default function CrewRail() {
  const { user, publishableKey } = useAccount();
  const signedIn = Boolean(user?.signedIn);
  const [crews, setCrews] = useState<CrewLine[]>([]);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(() => {
    myCrews().then(
      ({ items }) => setCrews(items),
      () => {}, // The rail is a shortcut. The page works without it.
    );
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, signedIn]);

  // Someone who asked for a crew and had to sign in first carries on from there.
  useEffect(() => {
    if (!signedIn || sessionStorage.getItem(WANTS_CREW) === null) return;
    sessionStorage.removeItem(WANTS_CREW);
    setStarting(true);
  }, [signedIn]);

  const start = () => {
    if (signedIn) {
      setStarting(true);
      return;
    }
    sessionStorage.setItem(WANTS_CREW, '1');
    account.signIn();
  };

  if (!signedIn && !publishableKey) return null;

  return (
    <section aria-label="Your crews" className="mx-auto max-w-6xl px-6 pb-10">
      {crews.length > 0 && (
        <ul className="mb-3 divide-y divide-line border-y border-line">
          {crews.map((crew) => (
            <li key={crew.slug}>
              <a href={`/r/${crew.slug}`} className="flex h-11 items-center justify-between gap-4 text-sm">
                <span className="min-w-0 truncate font-medium">{crew.name}</span>
                <span className={crew.here > 0 ? 'shrink-0 text-text' : 'shrink-0 text-muted'}>{hereLine(crew.here)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {starting ? (
        <StartCrew onCancel={() => setStarting(false)} />
      ) : (
        <button type="button" onClick={start} className="btn btn-quiet">
          Start a crew
        </button>
      )}
    </section>
  );
}
