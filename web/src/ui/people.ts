/**
 * One muted hue per person, light enough to read as a name and to carry dark initials.
 * No error red and no link blue: a colour here means a person and nothing else.
 */
export const AVATAR_COLORS = ['#e0a884', '#d8bb6c', '#c8c864', '#a9c47c', '#8fce8f', '#79c4a6', '#7bcbc0', '#72bdd0', '#c0a6e2', '#d6a2dc', '#e3a3d2', '#e2a2bb'];

/** A person's hue comes from their id alone, so they look the same on every page and in every room. */
export const hueOf = (userId = ''): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) hash = Math.imul(hash ^ userId.charCodeAt(index), 0x01000193) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#e0a884';
};

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
