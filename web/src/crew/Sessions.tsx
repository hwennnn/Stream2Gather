import { useEffect, useState } from 'react';
import { RecapCard } from '../recap/RecapCard';
import { DISCLOSURE, together } from '../recap/words';
import { initials } from '../ui/format';
import { crewApi, type PastSession, type SessionPage } from './api';

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** Measured on our own clock, never from a video's length. */
const lasted = (session: PastSession): string => together(Date.parse(session.endedAt) - Date.parse(session.startedAt));

const FACES = 3;

/** The first thing they watched, and how much came after it. */
const watched = ({ videos }: PastSession): string => {
  const [first] = videos;
  if (!first) return 'Nothing played';
  const title = first.media?.title ?? 'Video unavailable';
  return videos.length > 1 ? `${title} + ${videos.length - 1} more` : title;
};

/** Discs stay neutral: a session carries names, not ids, and a person's hue comes from their id. */
const SessionRow = ({ slug, session, hasRecap }: { slug: string; session: PastSession; hasRecap: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-1 text-sm">
      <div className="flex min-h-11 items-center gap-3">
        <span aria-hidden="true" className="flex w-[60px] shrink-0 -space-x-1.5">
          {session.people.slice(0, FACES).map((person, index) => (
            <span key={index} title={person.name} className="inline-flex size-7 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-muted ring-2 ring-ink">
              {initials(person.name)}
            </span>
          ))}
        </span>
        <span className="relative min-w-0 flex-1 truncate">
          {watched(session)}
          <span className="sr-only">, with {session.people.map((person) => person.name).join(', ')}</span>
        </span>
        <span className="shrink-0 text-[13px] text-dim tabular-nums">
          {DAY.format(Date.parse(session.startedAt))}
          <span className="phone:hidden">, {lasted(session)}</span>
        </span>
        {hasRecap && (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="btn btn-ghost btn-sm -mr-2.5 shrink-0">
            {open ? 'Hide recap' : 'Recap'}
          </button>
        )}
      </div>
      {open && <RecapCard slug={slug} sessionId={session.id} />}
    </li>
  );
};

/** The crew's past sessions, loaded once for the card and the list. */
export const useSessions = (slug: string) => {
  const [page, setPage] = useState<SessionPage | null>(null);

  useEffect(() => {
    let live = true;
    crewApi.sessions(slug).then(
      (first) => live && setPage(first),
      () => live && setPage({ items: [] }),
    );
    return () => {
      live = false;
    };
  }, [slug]);

  return [page, setPage] as const;
};

/** Past watch parties, newest first. The newest has its recap at the top of the page. */
export const Sessions = ({ slug, page, setPage }: { slug: string; page: SessionPage | null; setPage: (page: SessionPage) => void }) => {
  const more = () => {
    if (!page?.next) return;
    crewApi.sessions(slug, page.next).then(
      (next) => setPage({ items: [...page.items, ...next.items], next: next.next }),
      () => {}, // The button stays, so it can be tried again.
    );
  };

  if (!page) return null;

  return (
    <section aria-label="Sessions" className="mt-8">
      <h2 className="text-sm font-semibold">Sessions</h2>
      {page.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Your first watch party will show up here.</p>
      ) : (
        <>
          <ul aria-label="Past sessions" className="mt-2 divide-y divide-line border-y border-line">
            {page.items.map((session, index) => (
              <SessionRow key={session.id} slug={slug} session={session} hasRecap={index > 0} />
            ))}
          </ul>
          {page.next && (
            <button type="button" onClick={more} className="btn btn-ghost btn-sm mt-1 -ml-2.5">
              Older
            </button>
          )}
          <p className="mt-2 text-xs text-dim">{DISCLOSURE}</p>
        </>
      )}
    </section>
  );
};
