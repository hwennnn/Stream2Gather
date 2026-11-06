import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, post, request, type Person } from '../api/http';
import { account, useAccount } from '../auth/account';
import { START_CREW } from '../auth/words';
import { inThere, ReturnRow } from '../routes/landing/Sections';
import { navigate } from '../routes/router';
import type { CrewLine } from './api';

// Both calls live here, not in crew/api: a module shared with the room page costs first-load JS.
const myCrews = () => request<{ items: CrewLine[] }>('/v1/me/crews');
const startCrew = (name: string) => post<{ slug: string }>('/v1/crews', { name });

const POLL_MS = 30_000;
/** Faces cost a read each, so only the first few live crews get them. */
const WITH_FACES = 5;
/** Survives the redirect back from sign-in, which reloads the page. */
const WANTS_CREW = 's2g:start-crew';

const hereLine = (here: number) => (here === 0 ? 'Nobody’s here' : `${here} here`);

const facesOf = async (crews: CrewLine[]): Promise<Map<string, Person[]>> => {
  const live = crews.filter(({ here }) => here > 0).slice(0, WITH_FACES);
  const found = await Promise.all(
    live.map(({ slug }) =>
      api.preview(slug).then(
        ({ members }): [string, Person[]] => [slug, members ?? []],
        (): [string, Person[]] => [slug, []], // A count still says someone's there.
      ),
    ),
  );
  return new Map(found);
};

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

/** The landing page's way back into a crew, and into starting one. `except` is already on the page. */
export default function CrewRail({ except }: { except?: string }) {
  const { user, publishableKey } = useAccount();
  const signedIn = Boolean(user?.signedIn);
  const [crews, setCrews] = useState<CrewLine[]>([]);
  const [faces, setFaces] = useState(new Map<string, Person[]>());
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(() => {
    myCrews().then(
      ({ items }) => {
        setCrews(items);
        void facesOf(items).then(setFaces);
      },
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
    account.signIn(START_CREW);
  };

  if (!signedIn && !publishableKey) return null;

  const shown = crews.filter(({ slug }) => slug !== except);

  return (
    <section aria-label="Your crews" className={shown.length > 0 ? `mb-10 phone:mb-8 ${except ? '-mt-[41px] phone:-mt-[33px]' : ''}` : 'order-1 mt-12 phone:mt-8'}>
      {shown.length > 0 && (
        <ul className="mb-3 divide-y divide-line border-y border-line">
          {shown.map((crew) => {
            const people = faces.get(crew.slug) ?? [];
            return (
              <li key={crew.slug}>
                <ReturnRow href={`/r/${crew.slug}`} title={crew.name} note={people.length > 0 ? inThere(people) : hereLine(crew.here)} people={people} />
              </li>
            );
          })}
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
