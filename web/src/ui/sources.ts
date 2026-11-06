const NAMES = new Map([
  ['youtube', 'YouTube'],
  ['direct', 'Direct link'],
  ['vimeo', 'Vimeo'],
  ['twitch', 'Twitch'],
]);

export const sourceName = (source: string): string => NAMES.get(source) ?? source;

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
