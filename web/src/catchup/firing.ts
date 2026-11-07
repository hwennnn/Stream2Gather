/** Further than this between two polls is someone seeking, not the video playing. */
const JUMP_MS = 2000;

type Timed = { posMs: number };

/** Where a moment left now goes: a hair behind the player, or the next poll takes it for one still to come. */
export const posMsAt = (seconds: number): number => Math.max(0, Math.floor(seconds * 1000) - 1);

/**
 * Decides which moments the video has just reached. Moments only fire when normal
 * play crosses them: seeking, in either direction, moves the cursor and fires nothing.
 */
export const createFiring = <T extends Timed>(initial: T[]) => {
  const moments = [...initial].sort((a, b) => a.posMs - b.posMs);
  let cursor = 0;
  let last: number | null = null;

  const firstFrom = (ms: number) => {
    const found = moments.findIndex((moment) => moment.posMs >= ms);
    return found === -1 ? moments.length : found;
  };

  return {
    /** Everything the video has passed, in order. */
    passed: () => moments.slice(0, cursor),
    all: () => moments,

    tick(seconds: number, playing: boolean): T[] {
      const ms = seconds * 1000;
      // Resting on the spot says nothing new. At the very start nothing can sit behind the player.
      if (!playing && ms === last) return [];
      const jumped = last === null || ms < last || ms - last > JUMP_MS;
      last = ms;
      if (!playing || jumped) {
        cursor = firstFrom(ms);
        return [];
      }
      const from = cursor;
      cursor = firstFrom(ms + 1);
      return moments.slice(from, cursor);
    },

    /** Your own reaction lands where you are, already passed. */
    add(moment: T) {
      const at = firstFrom(moment.posMs + 1);
      moments.splice(at, 0, moment);
      if (at <= cursor) cursor += 1;
    },
  };
};
