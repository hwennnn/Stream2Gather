import { ApiError } from '../../api/http';

export const BAD_LINK = 'That isn’t a YouTube link.';
export const EMPTY = 'Paste a YouTube link first.';

export type Failure = {
  text: string;
  /** False when a new room would only fail the same way, so nothing should offer one. */
  canStartRoom: boolean;
};

export const failureFor = (failure: unknown): Failure => {
  if (!(failure instanceof ApiError)) return { text: 'Could not reach the server. Try again.', canStartRoom: true };
  return {
    text: /not supported/i.test(failure.message) ? BAD_LINK : failure.message,
    canStartRoom: failure.code !== 'rate_limited',
  };
};
