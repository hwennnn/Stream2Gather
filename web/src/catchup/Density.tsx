import { dotsOf } from '../recap/night';
import { Track } from '../recap/Track';
import type { Moment } from './api';

type Props = { moments: Moment[]; lengthMs: number; onSeek: (ms: number) => void };

/** Where the crew reacted, on the same track as a recap, under the player and never on it. Clicking goes there. A video of unknown length gets none, because it would be a false scale. */
export const Density = ({ moments, lengthMs, onSeek }: Props) => {
  if (moments.length === 0 || lengthMs <= 0) return null;
  return (
    <div
      role="img"
      aria-label="Where the reactions are"
      className="night-seek"
      onClick={(event) => {
        const { left, width } = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - left) / width) * lengthMs);
      }}
    >
      <Track dots={dotsOf(moments, lengthMs)} />
    </div>
  );
};
