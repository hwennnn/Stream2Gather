import { ApiError } from '../../api/http';

const OPTIONAL: [string, string][] = [
  ['vimeo', 'Vimeo'],
  ['twitch', 'Twitch'],
];

/** "YouTube", or "YouTube, Vimeo or Twitch": only what this server has switched on. */
export const linkKinds = (sources: string[] = []): string => {
  const kinds = ['YouTube', ...OPTIONAL.filter(([id]) => sources.includes(id)).map(([, name]) => name)];
  const last = kinds.pop();
  return kinds.length > 0 ? `${kinds.join(', ')} or ${last}` : `${last}`;
};

export const badLink = (kinds: string): string => `That isn’t a ${kinds} link.`;
export const emptyNote = (kinds: string): string => `Paste a ${kinds} link first.`;

export type Failure = {
  text: string;
  /** False when a new room would only fail the same way, so nothing should offer one. */
  canStartRoom: boolean;
};

export const failureFor = (failure: unknown, kinds: string): Failure => {
  if (!(failure instanceof ApiError)) return { text: 'Could not reach the server. Try again.', canStartRoom: true };
  return {
    text: /not supported/i.test(failure.message) ? badLink(kinds) : failure.message,
    canStartRoom: failure.code !== 'rate_limited',
  };
};
