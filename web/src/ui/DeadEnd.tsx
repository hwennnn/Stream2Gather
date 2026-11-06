import { useState } from 'react';
import type { Person } from '../api/http';
import { startRoom } from '../routes/router';
import { Door, EmptySeats, MoreSeats, SeatedPerson, SHOWN_SEATS, type Seated } from './Door';
import { firstName, listNames } from './people';

export type Ending = {
  title: string;
  body: string;
  /** Whose seats these are, if the page knows. */
  people?: Seated[];
  /** A room people have left, rather than one they're in. */
  past?: boolean;
  /** The room is fine and only a seat is missing, so a new room would split the group. */
  full?: boolean;
  /** There are no chairs to show, because there may be nothing wrong with the room. */
  bare?: boolean;
};

/** A room nobody's in still has its chairs. */
const EMPTY_ROW = 5;

export const ENDINGS = {
  missing: { title: 'This room doesn’t exist.', body: 'The link may be wrong. Check it with whoever sent it.' },
  closed: { title: 'This room’s night is over.', body: 'Start a new one and send the link round.', past: true },
  unreachable: { title: 'Can’t reach this room.', body: 'Check your connection, then try again.', bare: true },
  page: { title: 'Nothing’s showing here.', body: 'There’s no page at this address. Check the link, or go home and start a room.' },
} as const;

export const closedRoom = (people: Seated[]): Ending => {
  const names = people.map(({ name }) => firstName(name));
  if (names.length === 0) return ENDINGS.closed;
  return { ...ENDINGS.closed, people, body: `${listNames(names)} ${names.length > 1 ? 'were' : 'was'} here. Start a new one and send the link round.` };
};

export const fullRoom = (people: (Seated & Pick<Person, 'role'>)[]): Ending => {
  const host = people.find(({ role }) => role === 'host');
  return { title: 'This room is full.', body: host ? `Every seat is taken. Ask ${firstName(host.name)} to open another room.` : 'Every seat is taken. One may free up soon.', people, full: true };
};

const SeatRow = ({ people, past }: { people: Seated[]; past?: boolean }) => (
  <ul aria-label="Seats" className="seats door-row">
    {people.slice(0, SHOWN_SEATS).map((person) => (
      <SeatedPerson key={person.userId} person={person} away={past} />
    ))}
    <MoreSeats count={people.length - SHOWN_SEATS} />
  </ul>
);

const EmptyRow = () => (
  <ul aria-hidden="true" className="seats door-row">
    <EmptySeats count={EMPTY_ROW} />
  </ul>
);

/** Every way a room can be out of reach ends here, with a way forward. */
export const DeadEnd = ({ title, body, people = [], past = false, full = false, bare = false, home = false, onRetry }: Ending & { onRetry?: () => void; home?: boolean }) => {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await startRoom();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <Door seats={people.length > 0 ? <SeatRow people={people} past={past} /> : !bare && <EmptyRow />}>
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em] text-balance">{title}</h1>
      <p className="mt-1.5 text-muted">{body}</p>
      <div className="mt-5 flex flex-col gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn btn-primary">
            Try again
          </button>
        )}
        {full && (
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary">
            Check for a seat
          </button>
        )}
        {home && (
          <a href="/" className="btn btn-primary">
            Go home
          </a>
        )}
        {!onRetry && !full && !home && (
          <button type="button" disabled={busy} onClick={() => void start()} className="btn btn-primary">
            {busy ? 'Opening…' : 'Start a new room'}
          </button>
        )}
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-[13px] text-bad">
          {problem}
        </p>
      )}
    </Door>
  );
};
