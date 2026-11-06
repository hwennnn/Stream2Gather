/**
 * One muted hue per person, light enough to read as a name and to carry dark initials.
 * No error red and no link blue: a colour here means a person and nothing else.
 */
export const AVATAR_COLORS = ['#e0a884', '#d8bb6c', '#c8c864', '#a9c47c', '#8fce8f', '#79c4a6', '#7bcbc0', '#72bdd0', '#c0a6e2', '#d6a2dc', '#e3a3d2', '#e2a2bb'];

/** Which of the colours each person has in this room. */
export type Hues = Record<string, number>;

const usualHue = (userId: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) hash = Math.imul(hash ^ userId.charCodeAt(index), 0x01000193) >>> 0;
  return hash % AVATAR_COLORS.length;
};

const stepsApart = (a: number, b: number): number => {
  const steps = Math.abs(a - b);
  return Math.min(steps, AVATAR_COLORS.length - steps);
};

/** Neighbours on the wheel pass for each other across a row, so one step away isn't far enough. */
const CLEAR = 2;

const hueBeside = (preferred: number, taken: number[]): number => {
  const clearance = (hue: number) => Math.min(AVATAR_COLORS.length, ...taken.map((other) => stepsApart(hue, other)));
  if (clearance(preferred) >= CLEAR) return preferred;
  const hues = AVATAR_COLORS.map((_, hue) => hue).sort((a, b) => stepsApart(a, preferred) - stepsApart(b, preferred));
  return hues.reduce((best, hue) => (clearance(hue) > clearance(best) ? hue : best), preferred);
};

/**
 * Everyone here keeps the colour they have, and a newcomer gets their usual one unless someone
 * in the room looks like it. Then they get whichever stands furthest from everyone. A room with
 * more people than colours has to repeat one.
 */
export const placeHues = (kept: Hues, people: string[]): Hues => {
  const taken: number[] = [];
  const next = { ...kept };
  const newcomers = people.filter((userId) => {
    const hue = kept[userId];
    if (hue === undefined || taken.includes(hue)) return true;
    taken.push(hue);
    return false;
  });
  for (const userId of newcomers) {
    const hue = hueBeside(usualHue(userId), taken);
    next[userId] = hue;
    taken.push(hue);
  }
  return next;
};

let roomHues: Hues = {};

/** While a room is open, its colours are the ones every part of it shows. */
export const setRoomHues = (hues: Hues) => {
  roomHues = hues;
};

/** A person's hue is the same on every page, except where someone in the same room already looks like it. */
export const hueOf = (userId = ''): string => AVATAR_COLORS[roomHues[userId] ?? usualHue(userId)] ?? '#e0a884';

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** "Maya", "Maya and Sam", "Maya, Sam and Priya", "Maya, Sam and 3 others". */
export const listNames = (names: string[]): string => {
  const [first, second, third] = names;
  if (!first) return '';
  if (!second) return first;
  if (!third) return `${first} and ${second}`;
  if (names.length === 3) return `${first}, ${second} and ${third}`;
  return `${first}, ${second} and ${names.length - 2} others`;
};
