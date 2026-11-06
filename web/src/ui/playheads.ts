import type { RoomView } from '../room/session';

/** How far behind the left end of the track is, in seconds. */
export const BEHIND_S = 30;
/** Where the room's own playhead sits on the track, in percent. It's the end of the line, not progress through the video: this is the last half a minute, up to now. Only someone ahead goes past it. */
export const ROOM_AT = 96;
const GAP = 2;
/** Closer to the room than this and someone is simply with it: on a track this size it wouldn't show. */
const TOGETHER_S = 1;

/** Stopped players don't report again, so someone buffering falls behind at the speed of the video. */
const FALLING = new Set(['buffering', 'stalled']);

/** Seconds this person's playhead is from the room's. Behind is negative. */
export const playheadOffset = (view: RoomView, userId: string, now: number): number => {
  const report = view.viewerDrift[userId];
  if (!report || view.playback.status !== 'playing') return 0;
  const falling = FALLING.has(view.viewerStates[userId] ?? '');
  return report.drift - (falling ? ((now - report.at) / 1000) * view.playback.rate : 0);
};

/** Everyone who's with the room is the room's one tick. A dot means someone has come away from it. */
export const isApart = (offset: number): boolean => Math.abs(offset) >= TOGETHER_S;

/** Percent along the track for each offset, in the same order. People on the same frame stand side by side, so each still has a dot. */
export const placeDots = (offsets: number[]): number[] => {
  const wanted = offsets.map((offset) => Math.min(100, Math.max(0, ROOM_AT + (offset / BEHIND_S) * ROOM_AT)));
  const gap = Math.min(GAP, 100 / Math.max(offsets.length, 1));
  const placed = [...wanted];
  const order = wanted.map((_, index) => index).sort((a, b) => (wanted[a] ?? 0) - (wanted[b] ?? 0));
  let last = -Infinity;
  for (const index of order) {
    last = Math.max(wanted[index] ?? 0, last + gap);
    placed[index] = last;
  }
  const sum = (list: number[]) => list.reduce((total, value) => total + value, 0);
  const shift = (sum(wanted) - sum(placed)) / Math.max(offsets.length, 1);
  return placed.map((value) => Math.min(100, Math.max(0, value + shift)));
};
