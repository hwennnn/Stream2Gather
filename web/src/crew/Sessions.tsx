import { useEffect, useState } from 'react';
import { crewApi, type PastSession, type SessionPage } from './api';

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** Measured on our own clock, never from a video's length. */
const lasted = (session: PastSession): string => {
  const minutes = Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const titles = (session: PastSession): string =>
  session.videos.map((video) => video.media?.title ?? 'Video unavailable').join(', ') || 'Nothing played';

const SessionRow = ({ session }: { session: PastSession }) => (
  <li className="py-2 text-sm">
    <p className="line-clamp-2">{titles(session)}</p>
    <p className="mt-0.5 text-[13px] text-muted">
      {DAY.format(Date.parse(session.startedAt))}, <span className="fig text-[13px]">{lasted(session)}</span>, {session.people.map((person) => person.name).join(', ')}
    </p>
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
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {page.items.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
          {page.next && (
            <button type="button" onClick={more} className="btn btn-ghost btn-sm mt-1 -ml-2.5">
              Older
            </button>
          )}
          <p className="mt-2 text-xs text-dim">Reactions and watch stats come from Stream2Gather, not YouTube.</p>
        </>
      )}
    </section>
  );
};
