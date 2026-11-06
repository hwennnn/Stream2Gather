import { useEffect, useState } from 'react';
import { PastFace, RecapCard } from '../recap/RecapCard';
import { DISCLOSURE, nightOf, together } from '../recap/words';
import { crewApi, type PastSession, type SessionPage } from './api';

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

/** One night on a line: who, when, what. Each face stays in its person's hue. */
const SessionRow = ({ slug, session, hasRecap }: { slug: string; session: PastSession; hasRecap: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-1 text-sm">
      <div className="flex min-h-14 items-center gap-3">
        <span aria-hidden="true" className="flex w-[60px] shrink-0 -space-x-1.5">
          {session.people.slice(0, FACES).map((person, index) => (
            <PastFace key={index} person={person} className="size-7 text-[11px] ring-2 ring-ink" />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{nightOf(session.startedAt)}</span>
          {/* Relative, so the names for screen readers stay inside the row and off a phone's width. */}
          <span className="relative block truncate text-[13px] text-muted">
            {watched(session)}
            <span className="sr-only">, with {session.people.map((person) => person.name).join(', ')}</span>
          </span>
        </span>
        <span className="fig shrink-0 text-[13px] text-dim phone:hidden">{lasted(session)}</span>
        {hasRecap && (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="btn btn-ghost btn-sm -mr-2.5 shrink-0">
            {open ? 'Hide' : 'Recap'}
          </button>
        )}
      </div>
      {open && <RecapCard slug={slug} sessionId={session.id} people={session.people} titled={false} />}
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

/** Past nights, newest first. The newest has its recap at the top of the page. */
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
    <section aria-label="Past nights" className="mt-8">
      <h2 className="text-sm font-semibold">Past nights</h2>
      {page.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Your first night together will show up here.</p>
      ) : (
        <>
          <ul aria-label="Past nights" className="mt-2 divide-y divide-line border-y border-line">
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
