import { AVATAR_COLORS, avatarColor } from './format';

const seated = new Map<string, string>();

/** Everyone in the room gets a hue nobody else there has, and keeps it for as long as this page is open. */
export const seatHues = (userIds: readonly string[]): void => {
  const taken = new Set<string>();
  const unseated = userIds.filter((id) => {
    const hue = seated.get(id);
    if (!hue || taken.has(hue)) return true;
    taken.add(hue);
    return false;
  });
  for (const id of unseated) {
    const first = AVATAR_COLORS.indexOf(avatarColor(id));
    const hue = AVATAR_COLORS.map((_, step) => AVATAR_COLORS[(first + step) % AVATAR_COLORS.length]).find((next) => next && !taken.has(next));
    seated.set(id, hue ?? avatarColor(id));
    if (hue) taken.add(hue);
  }
};

export const hueOf = (userId = ''): string => seated.get(userId) ?? avatarColor(userId);

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
