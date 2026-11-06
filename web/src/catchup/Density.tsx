import type { Moment } from './api';

const BARS = 96;

const bars = (moments: Moment[], lengthMs: number): number[] => {
  const counts = new Array<number>(BARS).fill(0);
  for (const moment of moments) {
    const bar = Math.min(Math.floor((moment.posMs / lengthMs) * BARS), BARS - 1);
    counts[bar] = (counts[bar] ?? 0) + 1;
  }
  const most = Math.max(...counts, 1);
  return counts.map((count) => count / most);
};

type Props = { moments: Moment[]; lengthMs: number; onSeek: (ms: number) => void };

/** Where the crew reacted, under the player and never on it. Clicking goes there. A video of unknown length gets none, because it would be a false scale. */
export const Density = ({ moments, lengthMs, onSeek }: Props) => {
  if (moments.length === 0 || lengthMs <= 0) return null;
  return (
    <div
      role="img"
      aria-label="Where the reactions are"
      className="mt-2 flex h-8 cursor-pointer items-end gap-px"
      onClick={(event) => {
        const { left, width } = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - left) / width) * lengthMs);
      }}
    >
      {bars(moments, lengthMs).map((height, index) => (
        <span key={index} className="min-w-0 flex-1 bg-dim" style={{ height: height ? `${Math.max(height * 100, 10)}%` : 1 }} />
      ))}
    </div>
  );
};
