import { useRef } from 'react';
import type { RoomView } from '../room/session';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { firstName, hueOf, seatHues } from './people';
import { placeSeats, rowLength, standing, type Row } from './seatRow';

const STATES = new Map([
  ['buffering', 'buffering'],
  ['stalled', 'at an ad'],
  ['correcting', 'catching up'],
  ['unavailable', 'can’t play'],
]);

export const useSeats = (view: RoomView): Row => {
  const row = useRef<Row>([]);
  row.current = placeSeats(row.current, view.members);
  seatHues(view.members.map((person) => person.userId));
  return row.current;
};

type Props = {
  view: RoomView;
  row: Row;
  /** The name of whoever has their hand on the player right now. */
  actor: string | null;
  onInvite: () => void;
  onPeople: () => void;
  compact?: boolean;
};

/** Everyone's place in the room, facing the screen. Nobody ever changes seat. */
export const Seats = ({ view, row, actor, onInvite, onPeople, compact = false }: Props) => {
  const length = rowLength(row);
  const firstEmpty = Array.from({ length }, (_, index) => row[index]).findIndex((seat) => !seat);
  const extra = standing(row, view.members);

  return (
    <ul aria-label="In the room" data-compact={compact} className="seats">
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
            <li key={index} className="seat">
              <button type="button" aria-label="Invite" onClick={onInvite} className="seat-invite" data-alone={view.alone}>
                <span className="seat-empty">
                  <Icon name="plus" className="size-3.5" />
                </span>
                <span className="seat-name">Invite</span>
              </button>
            </li>
          );
        }
        const { person, here } = seat;
        const own = person.userId === view.self?.userId;
        const status = view.viewerStates[person.userId];
        const state = status && STATES.get(status);
        const reaction = view.reactions.findLast((entry) => entry.name === person.name);
        return (
          <li
            key={person.userId}
            title={compact ? undefined : person.name}
            data-acting={person.name === actor}
            data-away={!here}
            data-trouble={state !== undefined}
            style={{ '--hue': hueOf(person.userId) } as React.CSSProperties}
            className="seat"
          >
            <span className="seat-disc">
              <Avatar person={person} labelled={false} className="size-full text-[13px]" />
              {reaction && (
                <span key={reaction.id} aria-hidden="true" className="seat-reaction">
                  {reaction.emoji}
                </span>
              )}
            </span>
            <span className="seat-name">{state ?? (own ? 'You' : firstName(person.name))}</span>
          </li>
        );
      })}
      {extra > 0 && (
        <li className="seat">
          <button type="button" onClick={onPeople} aria-label={`${extra} more people`} className="seat-invite">
            <span className="seat-more">+{extra}</span>
          </button>
        </li>
      )}
    </ul>
  );
};
