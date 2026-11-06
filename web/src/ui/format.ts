export const formatTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

/** Bright enough to read as a name on the panel, and to carry dark initials. */
export const AVATAR_COLORS = [
  '#8fa8ff', '#7dd3fc', '#a78bfa', '#5eead4', '#f0abfc', '#fcd34d',
  '#fb7185', '#86efac', '#fdba74', '#bef264', '#f9a8d4', '#a0f08c',
];

export const avatarColor = (id: string): string => {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#8fa8ff';
};

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const firstGrapheme = (word: string): string => {
  for (const { segment } of graphemes.segment(word)) return segment;
  return '';
};

export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => firstGrapheme(word).toUpperCase())
    .join('');

const URL_LIKE = /^(https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)/i;

export const looksLikeUrl = (value: string): boolean => URL_LIKE.test(value.trim());

export const normalizeUrl = (value: string): string => {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export const isYouTubeUrl = (value: string): boolean => {
  try {
    return YOUTUBE_HOSTS.has(new URL(normalizeUrl(value)).hostname.toLowerCase());
  } catch {
    return false;
  }
};

export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** Splits chat text around its links. Closing punctuation stays out of the link. */
export const splitLinks = (text: string): TextPart[] => {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINK)) {
    const link = match[0].replace(/[.,;:!?)\]}'’”]+$/, '');
    if (match.index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, match.index) });
    parts.push({ kind: 'link', text: link, href: normalizeUrl(link) });
    cursor = match.index + link.length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
};

export const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const ADJECTIVES = ['Amber', 'Brave', 'Calm', 'Cosmic', 'Cozy', 'Golden', 'Lucky', 'Mellow', 'Neon', 'Quiet', 'Solar', 'Velvet'];
const NOUNS = ['Otter', 'Falcon', 'Comet', 'Lantern', 'Panda', 'Maple', 'Raven', 'Rocket', 'Sparrow', 'Tiger', 'Tulip', 'Walrus'];

const pick = (words: string[]): string => words[Math.floor(Math.random() * words.length)] ?? '';

/** First-time guests have no name until they join, so the gate suggests one. */
export const suggestName = (): string => `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
