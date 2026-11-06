import type { Person } from '../api/http';

export const MAX_SEATS = 8;
/** A room looks like a room from the start: you, and seats saved for others. */
export const MIN_SEATS = 4;

export type Taken = { person: Person; here: boolean };
export type Row = (Taken | null)[];

/**
 * Seats never move. A person keeps theirs for the visit, and it waits for them
 * if they step out. Only a newcomer with nowhere else to sit takes an empty one.
 */
export const placeSeats = (row: Row, members: Person[], max = MAX_SEATS): Row => {
  const present = new Map(members.map((person) => [person.userId, person]));
  const next: Row = row.map((seat) => {
    if (!seat) return null;
    const person = present.get(seat.person.userId);
    return person ? { person, here: true } : { ...seat, here: false };
  });
  const seated = new Set(next.flatMap((seat) => (seat ? [seat.person.userId] : [])));
  for (const person of members) {
    if (seated.has(person.userId)) continue;
    const free = next.findIndex((seat) => seat === null);
    const vacated = next.findIndex((seat) => seat !== null && !seat.here);
    const index = free >= 0 ? free : next.length < max ? next.length : vacated;
    if (index < 0) continue;
    next[index] = { person, here: true };
  }
  return next;
};

/** Everyone who didn't fit in the row. */
export const standing = (row: Row, members: Person[]): number =>
  members.length - row.filter((seat) => seat?.here).length;

/** The row as drawn: taken seats, then empty ones, one of which is the invite. */
export const rowLength = (row: Row, max = MAX_SEATS): number => Math.min(max, Math.max(MIN_SEATS, row.length + 1));
