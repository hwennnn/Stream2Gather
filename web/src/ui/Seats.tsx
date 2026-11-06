import { useRef, type CSSProperties } from 'react';
import type { RoomView } from '../room/session';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { firstName, hueOf } from './people';
import { MAX_SEATS, placeSeats, rowLength, standing, type Row } from './seatRow';
import { viewerState } from './status';
import { beatAt, type Beat } from './useBeat';

const STATES = new Map([
  ['buffering', 'catching up'],
  ['stalled', 'at an ad'],
  ['correcting', 'catching up'],
  ['unavailable', 'can’t play'],
]);

export const useSeats = (view: RoomView): Row => {
  const row = useRef<Row>([]);
  row.current = placeSeats(row.current, view.members, MAX_SEATS, view.vacated);
  return row.current;
};

/** An empty seat is an offer. Once the link is out it's taken, until whoever it was for sits in it. */
const InviteSeat = ({ alone, saved, onInvite, label = saved ? 'Seat saved' : 'Save a seat' }: { alone: boolean; saved: boolean; onInvite: () => void; label?: string }) => (
  <button type="button" aria-label="Invite" onClick={onInvite} className="seat-invite" data-alone={alone} data-saved={saved}>
    <span className="seat-empty">
      <Icon name={saved ? 'check' : 'plus'} className="size-3.5" />
    </span>
    <span className="seat-name">{label}</span>
  </button>
);

type Props = {
  view: RoomView;
  row: Row;
  /** The name of whoever has their hand on the player right now. */
  actor: string | null;
  /** The moment the row is in the middle of, if any. */
  beat?: Beat | null;
  /** The link has gone out, and nobody has come in on it yet. */
  saved?: boolean;
  onInvite: () => void;
  onPeople: () => void;
  compact?: boolean;
};

/** Everyone's place in the room, facing the screen. Nobody ever changes seat. */
export const Seats = ({ view, row, actor, beat = null, saved = false, onInvite, onPeople, compact = false }: Props) => {
  const length = rowLength(row);
  const firstEmpty = Array.from({ length }, (_, index) => row[index]).findIndex((seat) => !seat);
  const extra = standing(row, view.members);
  const origins = beat?.from.flatMap((id) => {
    const index = row.findIndex((seat) => seat?.person.userId === id);
    return index < 0 ? [] : [index];
  }) ?? [];
  // Whoever got up stays the thing to look at for as long as the room waits on them.
  const held = view.playback.status === 'paused' && Boolean(view.playback.pausedBy);
  const up = row.findIndex((seat) => seat?.person.userId === view.playback.pausedById);
  const lookingAt = origins.length === 0 && held && up >= 0 ? [up] : origins;
  const reactions = new Map(view.reactions.map((reaction) => [reaction.userId, reaction]));
  const seated = new Set(row.flatMap((seat) => (seat ? [seat.person.userId] : [])));
  const fromStanding = view.reactions.findLast(({ userId }) => !seated.has(userId));

  return (
    <ul aria-label="In the room" data-live={true} data-compact={compact} data-beat={beat?.kind} data-held={held} className="seats">
      {Array.from({ length }, (_, index) => {
        const seat = row[index];
        if (!seat) {
          if (index !== firstEmpty) {
            return (
              <li key={index} aria-hidden="true" className="seat">
                <span className="seat-empty" />
              </li>
            );
          }
          return (
            <li key={index} className="seat seat-pin">
              <InviteSeat alone={view.alone} saved={saved} onInvite={onInvite} />
            </li>
          );
        }
        const { person, here } = seat;
        const own = person.userId === view.self?.userId;
        const status = viewerState(view, person.userId);
        const state = status && STATES.get(status);
        const reaction = reactions.get(person.userId);
        const { dist, toward } = beatAt(index, lookingAt);
        return (
          <li
            key={person.userId}
            title={compact ? undefined : state ? `${person.name}, ${state}` : person.name}
            data-origin={beat ? origins.includes(index) : undefined}
            data-hop={reaction && reaction.id % 2}
            data-acting={person.name === actor}
            data-speaking={view.speaking.includes(person.userId)}
            data-away={!here}
            data-trouble={state !== undefined}
            style={{ '--hue': hueOf(person.userId), '--dist': dist, '--toward': toward } as CSSProperties}
            className="seat"
          >
            <span className="seat-disc">
              <Avatar person={person} labelled={false} className="size-full text-[13px]" />
              {reaction && (
                <span key={reaction.id} aria-hidden="true" className="seat-said">
                  {reaction.emoji}
                </span>
              )}
            </span>
            <span className="seat-name">
              {own ? 'You' : firstName(person.name)}
              {state && <span className="sr-only">, {state}</span>}
              {!here && <span className="sr-only">, stepped out</span>}
            </span>
          </li>
        );
      })}
      {extra > 0 && (
        <li className="seat seat-pin" data-count={true}>
          <button type="button" onClick={onPeople} aria-label={`${extra} more people`} className="seat-invite">
            <span className="seat-more">
              +{extra}
              {fromStanding && (
                <span key={fromStanding.id} aria-hidden="true" className="seat-said">
                  {fromStanding.emoji}
                </span>
              )}
            </span>
          </button>
        </li>
      )}
      {/* A busy room is when people ask for the link, so a full row still offers it. */}
      {firstEmpty < 0 && (
        <li className="seat seat-pin">
          <InviteSeat alone={view.alone} saved={false} onInvite={onInvite} label="Invite" />
        </li>
      )}
    </ul>
  );
};
