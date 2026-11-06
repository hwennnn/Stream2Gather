import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, type RoomPreview } from '../api/http';
import { useAccount } from '../auth/account';
import { Avatar } from './Avatar';
import { Door, EmptySeats, MoreSeats, SeatedPerson, SHOWN_SEATS, yourHue } from './Door';
import { formatTime, initials, suggestName } from './format';
import { firstName, listNames } from './people';

type JoinGateProps = {
  preview: RoomPreview | null;
  onJoin: (name: string, changed: boolean) => Promise<void>;
  /** Says whose room this is, for someone who has no seat to be saved. */
  heading?: string;
  /** A crew's room: an empty one is theirs, not one the visitor is first into. */
  crew?: boolean;
  /** What comes with this way in, under the button. */
  aside?: ReactNode;
  /** False when the room has no way in from here. */
  canJoin?: boolean;
};

const MAX_NAME = 32;
/** A room you arrive at early still has places in it. */
const MIN_EMPTY = 2;
const LOOK_IN_MS = 5000;
const SECOND_MS = 1000;

/** Keeps counting from what the server last said, so a room that's playing looks like one. */
const useRunningTime = (from: number, running: boolean): number => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!running) return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / SECOND_MS), SECOND_MS);
    return () => window.clearInterval(timer);
  }, [from, running]);
  return from + elapsed;
};

export const WhereItIs = ({ preview }: { preview: RoomPreview }) => {
  const { playback, nowPlaying } = preview;
  const paused = playback?.status === 'paused';
  const seconds = useRunningTime(playback?.pos ?? 0, playback?.status === 'playing');
  if (!nowPlaying || !playback || playback.status === 'idle') return null;
  const time = <span className="tabular-nums">{formatTime(seconds)}</span>;
  return <p className="mt-0.5 text-[13px] text-muted">{paused ? <>Paused at {time}</> : <>{time} in</>}</p>;
};

/** Someone at the door sees people sit down. A failed look leaves the last one showing. */
const useLookIn = (first: RoomPreview | null): RoomPreview | null => {
  const [latest, setLatest] = useState(first);
  const slug = first?.slug;
  useEffect(() => setLatest(first), [first]);
  useEffect(() => {
    if (!slug) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api.preview(slug).then(setLatest, () => {});
    }, LOOK_IN_MS);
    return () => window.clearInterval(timer);
  }, [slug]);
  return latest;
};

/** Yours: outlined with your initials as you type, and filled the moment you sit. */
const YourSeat = ({ name, userId, sitting }: { name: string; userId?: string; sitting: boolean }) => (
  <li className="seat seat-you">
    {sitting ? (
      <span className="seat-disc door-sit">
        <Avatar person={{ userId: userId ?? '', name }} labelled={false} className="size-full" />
      </span>
    ) : (
      <span style={yourHue(userId)} className="seat-empty door-mine">
        {initials(name)}
      </span>
    )}
    <span className="seat-name">{firstName(name)}</span>
  </li>
);

const whoElse = (names: string[]): string => {
  if (names.length === 0) return '';
  return `${listNames(names)} ${names.length > 1 ? 'are' : 'is'} here too. `;
};

/** The Join click is also the gesture that lets the video start with sound. */
export const JoinGate = ({ preview: first, onJoin, heading, crew = false, aside, canJoin = true }: JoinGateProps) => {
  const { user } = useAccount();
  const preview = useLookIn(first);
  const [suggested] = useState(suggestName);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const name = edited ?? user?.name ?? suggested;
  const seated = name.trim() || suggested;
  const ready = preview !== null;

  useEffect(() => {
    // On a slow load they can already be typing, and focus moving would eat the rest of their name.
    const free = document.activeElement === document.body;
    if (ready && free && window.matchMedia('(hover: hover)').matches) button.current?.focus();
  }, [ready]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || busy) return;
    setBusy(true);
    await onJoin(seated, seated !== user?.name);
  };

  const others = preview?.members ?? [];
  const inviter = others.find((person) => person.role === 'host') ?? others[0];
  const rest = others.filter((person) => person !== inviter).map((person) => firstName(person.name));
  const empties = heading ? 0 : Math.max(0, MIN_EMPTY - others.length);
  const showSeats = !heading || others.length > 0;
  const title = preview?.nowPlaying?.title;

  const seats = showSeats && (
    <ul aria-label="In the room" className="seats door-row">
      {others.slice(0, SHOWN_SEATS).map((person) => (
        <SeatedPerson key={person.userId} person={person} />
      ))}
      <MoreSeats count={others.length - SHOWN_SEATS} />
      {!heading && <YourSeat name={seated} userId={user?.id} sitting={busy} />}
      <EmptySeats count={empties} />
    </ul>
  );

  return (
    <Door media={preview?.nowPlaying} seats={seats}>
      <form onSubmit={(event) => void submit(event)} className="enter">
        {preview ? (
          <>
            {inviter && !heading && <p className="mb-1 truncate text-[13px] text-dim">{preview.name}</p>}
            <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em] text-balance">{heading ?? (inviter ? `${firstName(inviter.name)} saved you a seat` : preview.name)}</h1>
            {heading ? (
              title && <p className="mt-1 line-clamp-2 text-muted">Watching {title}</p>
            ) : inviter ? (
              <p className="mt-1 line-clamp-3 text-muted">
                {whoElse(rest)}
                {title ? `Watching ${title}` : 'Nothing’s on yet. You can pick.'}
              </p>
            ) : crew ? (
              <p className="mt-1 text-muted">Nobody’s in yet. The crew will sit down next to you.</p>
            ) : (
              <p className="mt-1 text-muted">You’re first in. Friends with the link will sit down next to you.</p>
            )}
            <WhereItIs preview={preview} />
          </>
        ) : (
          <div aria-hidden="true">
            <div className="skeleton h-7 w-4/5 rounded" />
            <div className="skeleton mt-2 h-4 w-3/5 rounded" />
          </div>
        )}

        {canJoin && (
          <>
            <label htmlFor="join-name" className="mt-5 block text-[13px] text-muted">
              Your name
            </label>
            <input
              id="join-name"
              value={name}
              maxLength={MAX_NAME}
              onChange={(event) => setEdited(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="field mt-1.5"
            />
            <button ref={button} type="submit" disabled={!preview || busy} className="btn btn-primary mt-2 w-full">
              Take your seat
            </button>
          </>
        )}

        {aside}
      </form>
    </Door>
  );
};
