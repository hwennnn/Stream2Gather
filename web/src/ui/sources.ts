const NAMES = new Map([
  ['youtube', 'YouTube'],
  ['direct', 'Direct link'],
  ['vimeo', 'Vimeo'],
  ['twitch', 'Twitch'],
]);

export const sourceName = (source: string): string => NAMES.get(source) ?? source;

const HOSTS: [RegExp, string][] = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)twitch\.tv$/, 'Twitch'],
];

/** The words for a link out to where a video lives. A file has no page of its own to name. */
export const openLabel = (url: string): string => {
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  const name = HOSTS.find(([pattern]) => pattern.test(host))?.[1];
  return name ? `Open on ${name}` : 'Open the link';
};

/**
 * Why a video won't play, naming the source only where it means something. It says
 * what happened, not why: a refusal's code has more than one cause, and the owner
 * is rarely the one who can be blamed for sure.
 */
export const failureReason = (source: string, kind: string): string => {
  const named = source !== 'direct';
  if (kind === 'ip_origin') return 'YouTube refuses many videos on an address made of numbers. Open this room at its site name instead.';
  if (kind === 'no_referrer') return 'YouTube couldn’t tell which site this is. A privacy extension may be hiding it.';
  if (kind === 'embed_blocked') {
    const name = sourceName(source);
    return named ? `${name} wouldn’t play it here. It may still play on ${name}.` : 'This stream doesn’t allow playback here.';
  }
  if (kind === 'network') {
    const blocker = named ? `, or anything blocking ${sourceName(source)}` : '';
    return `The player couldn’t load. Check your connection${blocker}.`;
  }
  return 'It may have been removed, or it isn’t available where you are.';
};

const LINK_KINDS = new Map([
  ['vimeo', 'Vimeo'],
  ['twitch', 'Twitch'],
  ['direct', '.m3u8'],
]);

/** Only YouTube has search, so the rest are named as links, and only when they're on. */
export const addPrompt = (sources: string[]): string => {
  const kinds = sources.flatMap((source) => LINK_KINDS.get(source) ?? []);
  const last = kinds.pop();
  if (!last) return 'Paste a link or search YouTube';
  return `Search YouTube or paste a ${kinds.length > 0 ? `${kinds.join(', ')} or ` : ''}${last} link`;
};
