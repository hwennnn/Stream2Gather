import { formatTime } from '../ui/format';

export { plural } from '../ui/format';

export const DISCLOSURE = 'Reactions and watch stats come from Stream2Gather, not YouTube.';

/** Time together, from our own clock. */
export const together = (ms: number): string => {
  const minutes = Math.max(Math.round(ms / 60_000), 1);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export const position = (ms: number): string => formatTime(ms / 1000);

/** The most used first, so the row reads as what the room did most. */
export const EmojiCounts = ({ counts }: { counts: Record<string, number> }) => (
  <span className="inline-flex flex-wrap gap-x-3">
    {Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([emoji, count]) => (
        <span key={emoji}>
          {emoji} <span className="fig text-[13px]">{count}</span>
        </span>
      ))}
  </span>
);

export const totalOf = (counts: Record<string, number>): number => Object.values(counts).reduce((sum, count) => sum + count, 0);
