import { memo, useEffect, useRef, useState, type AnimationEvent, type CSSProperties } from 'react';
import type { RoomView } from '../room/session';
import { expectedPosition } from '../sync/controller';
import { formatTime } from './format';
import { hueOf } from './people';
import { useTick } from './RoomStatus';
import { BEHIND_S, isApart, placeDots, playheadOffset, ROOM_AT } from './playheads';

const WAKE_MARKS = 24;
/** Reactions this close together are one moment: more of them make it bigger, not busier. */
const SAME_MOMENT_MS = 1500;
/** The most a moment grows, in reactions. */
const LOUDEST = 6;

type Reactions = RoomView['reactions'];
/** One moment on the track. It wears whichever emoji most people sent. */
type Mark = { id: number; at: number; tally: Record<string, number> };

export const markEmoji = ({ tally }: Mark): string => Object.entries(tally).reduce((most, entry) => (entry[1] > most[1] ? entry : most), ['', 0])[0];

export const markSize = ({ tally }: Mark): number => Math.min(Object.values(tally).reduce((sum, count) => sum + count, 0), LOUDEST);

export const addToWake = (marks: Mark[], fresh: Reactions, at: number): Mark[] =>
  fresh.reduce((next, { id, emoji }) => {
    const last = next.at(-1);
    if (!last || at - last.at >= SAME_MOMENT_MS) return [...next, { id, at, tally: { [emoji]: 1 } }].slice(-WAKE_MARKS);
    return [...next.slice(0, -1), { ...last, tally: { ...last.tally, [emoji]: (last.tally[emoji] ?? 0) + 1 } }];
  }, marks);

/**
 * What people reacted to stays where it happened. A reaction drops onto the room's playhead,
 * and the track's scale carries it left as the video moves on, so the last half a minute can
 * be read at a glance. It's a CSS animation at the video's own speed: no timers, and it stops
 * with the room.
 */
const Wake = memo(({ reactions, rate }: { reactions: Reactions; rate: number }) => {
  const [marks, setMarks] = useState<Mark[]>([]);
  const newest = useRef(reactions.at(-1)?.id ?? 0);

  useEffect(() => {
    const fresh = reactions.filter(({ id }) => id > newest.current);
    const last = fresh.at(-1);
    if (!last) return;
    newest.current = last.id;
    setMarks((now) => addToWake(now, fresh, Date.now()));
  }, [reactions]);

  const over = (id: number) => (event: AnimationEvent) => {
    if (event.target === event.currentTarget) setMarks((now) => now.filter((mark) => mark.id !== id));
  };

  return (
    <div className="wake" style={{ '--wake': `${BEHIND_S / rate}s` } as CSSProperties}>
      {marks.map((mark) => (
        <span key={mark.id} onAnimationEnd={over(mark.id)} className="wake-mark">
          <span style={{ '--loud': markSize(mark) } as CSSProperties}>{markEmoji(mark)}</span>
        </span>
      ))}
    </div>
  );
});

/** The room's playhead on one hairline, and anyone who's come away from it. Off the player, and in space that's always kept for it. */
export const SeatTrack = ({ view }: { view: RoomView }) => {
  const playing = view.playback.status === 'playing';
  useTick(playing);
  const now = Date.now();
  const apart = view.members
    .filter(({ userId }) => view.viewerStates[userId] !== 'unavailable')
    .map(({ userId }) => ({ userId, offset: playheadOffset(view, userId, now) }))
    .filter(({ offset }) => isApart(offset));
  const dots = placeDots(apart.map(({ offset }) => offset));

  // A jump leaves the wake pointing at moments that are no longer behind the room.
  const seeks = useRef(0);
  const action = useRef(view.lastAction);
  if (view.lastAction !== action.current) {
    action.current = view.lastAction;
    if (view.lastAction?.cause === 'seek') seeks.current += 1;
  }

  return (
    <div aria-hidden="true" data-moving={playing} className="seat-track">
      <div style={{ '--room-at': `${ROOM_AT}%` } as CSSProperties} className="seat-track-line">
        <Wake key={`${view.playback.item}:${seeks.current}`} reactions={view.reactions} rate={view.playback.rate} />
        <span className="seat-track-room" />
        {apart.map(({ userId }, index) => (
          <span key={userId} data-user={userId} style={{ left: `${dots[index]}%`, backgroundColor: hueOf(userId) }} className="seat-track-dot" />
        ))}
      </div>
      <span className="fig text-[13px] leading-none text-muted">{formatTime(expectedPosition(view.playback, now))}</span>
    </div>
  );
};
