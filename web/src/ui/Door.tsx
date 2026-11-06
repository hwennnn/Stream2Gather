import type { CSSProperties, ReactNode } from 'react';
import type { Media, Person } from '../api/http';
import { Avatar } from './Avatar';
import { DarkRoom } from './DarkRoom';
import { SiteHeader } from './Page';
import { firstName, hueOf } from './people';

export type Seated = Pick<Person, 'userId' | 'name' | 'avatarUrl'>;

/** What fits a 320px phone beside your own seat. */
export const SHOWN_SEATS = 4;

/** The same frame as the room: the screen, the seats under it, and a rail. Sitting down moves nothing. */
export const Door = ({ media, seats, children }: { media?: Media | null; seats?: ReactNode; children: ReactNode }) => (
  <div className="flex min-h-full flex-col">
    <SiteHeader />
    <main className="door">
      <div className="door-stage">
        <div className="door-screen">{media?.thumbnailUrl ? <img key={media.sourceId} src={media.thumbnailUrl} alt="" /> : <DarkRoom />}</div>
        {seats}
      </div>
      <div className="door-rail">{children}</div>
    </main>
  </div>
);

export const SeatedPerson = ({ person, away }: { person: Seated; away?: boolean }) => (
  <li data-away={away} className="seat">
    <span className="seat-disc">
      <Avatar person={person} labelled={false} className="size-full" />
    </span>
    <span className="seat-name">{firstName(person.name)}</span>
  </li>
);

export const MoreSeats = ({ count }: { count: number }) =>
  count > 0 ? (
    <li className="seat">
      <span className="seat-more">+{count}</span>
    </li>
  ) : null;

/** A place nobody has taken. */
export const EmptySeats = ({ count }: { count: number }) =>
  Array.from({ length: count }, (_, index) => (
    <li key={index} aria-hidden="true" className="seat">
      <span className="seat-empty" />
    </li>
  ));

/** Someone's seat in their colour, outlined until they sit in it. Nobody's colour is known until they have an id. */
export const yourHue = (userId?: string): CSSProperties => (userId ? ({ '--hue': hueOf(userId) } as CSSProperties) : {});
