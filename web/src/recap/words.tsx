import { formatTime } from '../ui/format';

export { plural } from '../ui/format';

export const DISCLOSURE = 'Reactions and watch stats come from Stream2Gather, not YouTube.';

/** Time together, from our own clock. */
export const together = (ms: number): string => {
  const minutes = Math.max(Math.round(ms / 60_000), 1);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export const position = (ms: number): string => formatTime(ms / 1000);

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Past midnight still belongs to the night before. */
const LATE_UNTIL = 5;
const MORNING_UNTIL = 12;
const AFTERNOON_UNTIL = 17;
const WEEKDAY = new Intl.DateTimeFormat('en', { weekday: 'long' });
const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

const partOf = (hour: number): string => {
  if (hour < LATE_UNTIL || hour >= AFTERNOON_UNTIL) return 'night';
  return hour < MORNING_UNTIL ? 'morning' : 'afternoon';
};

/** What the people there would call it: "Friday night", with the date once it's more than a week back. */
export const nightOf = (startedAt: string, now = Date.now()): string => {
  const start = new Date(startedAt);
  const hour = start.getHours();
  const day = new Date(start.getTime() - (hour < LATE_UNTIL ? DAY_MS : 0));
  const name = `${WEEKDAY.format(day)} ${partOf(hour)}`;
  return now - start.getTime() < WEEK_MS ? name : `${name}, ${DATE.format(day)}`;
};

/** Who reacted together, without a stat's voice. `you` is false for someone who wasn't there. */
export const whoReacted = (people: number, everyone: number, you: boolean): string => {
  if (!you) return `${people} people reacted`;
  return people >= everyone ? 'All of you reacted' : `${people} of you reacted`;
};

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
