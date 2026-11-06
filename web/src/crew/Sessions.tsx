import { useEffect, useState } from 'react';
import { initials } from '../ui/format';
import { crewApi, type PastSession, type SessionPage } from './api';

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** Measured on our own clock, never from a video's length. */
const lasted = (session: PastSession): string => {
  const minutes = Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const FACES = 3;

/** The first thing they watched, and how much came after it. */
const watched = ({ videos }: PastSession): string => {
  const [first] = videos;
  if (!first) return 'Nothing played';
  const title = first.media?.title ?? 'Video unavailable';
  return videos.length > 1 ? `${title} + ${videos.length - 1} more` : title;
};

/** Discs stay neutral: a session carries names, not ids, and a person's hue comes from their id. */
const SessionRow = ({ session }: { session: PastSession }) => (
  <li className="flex min-h-11 items-center gap-3 py-1 text-sm">
    <span aria-hidden="true" className="flex w-[60px] shrink-0 -space-x-1.5">
      {session.people.slice(0, FACES).map((person, index) => (
        <span key={index} title={person.name} className="inline-flex size-7 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-muted ring-2 ring-ink">
          {initials(person.name)}
        </span>
      ))}
    </span>
    <span className="min-w-0 flex-1 truncate">
      {watched(session)}
      <span className="sr-only">, with {session.people.map((person) => person.name).join(', ')}</span>
    </span>
    <span className="shrink-0 text-[13px] text-dim tabular-nums">
      {DAY.format(Date.parse(session.startedAt))}
      <span className="phone:hidden">, {lasted(session)}</span>
    </span>
  </li>
);

/** Past watch parties, newest first. */
export const Sessions = ({ slug }: { slug: string }) => {
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
            {page.items.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
          {page.next && (
            <button type="button" onClick={more} className="btn btn-ghost btn-sm mt-1 -ml-2.5">
              Older
            </button>
          )}
        </>
      )}
    </section>
  );
};
