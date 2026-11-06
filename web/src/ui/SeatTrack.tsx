import type { RoomView } from '../room/session';
import { expectedPosition } from '../sync/controller';
import { formatTime } from './format';
import { hueOf } from './people';
import { useTick } from './RoomStatus';
import { placeDots, playheadOffset } from './playheads';

/** Everyone's playhead on one hairline, against the room's clock. Off the player, and in space that's always kept for it. */
export const SeatTrack = ({ view }: { view: RoomView }) => {
  useTick(view.playback.status === 'playing');
  const now = Date.now();
  const watching = view.members.filter(({ userId }) => view.viewerStates[userId] !== 'unavailable');
  const dots = placeDots(watching.map(({ userId }) => playheadOffset(view, userId, now)));
  return (
    <div aria-hidden="true" className="seat-track">
      <div className="seat-track-line">
        {watching.map(({ userId }, index) => (
          <span key={userId} data-user={userId} style={{ left: `${dots[index]}%`, backgroundColor: hueOf(userId) }} className="seat-track-dot" />
        ))}
      </div>
      <span className="fig text-[13px] leading-none text-muted">{formatTime(expectedPosition(view.playback, now))}</span>
    </div>
  );
};
