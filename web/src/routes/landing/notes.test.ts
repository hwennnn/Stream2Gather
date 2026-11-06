import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { BAD_LINK, EMPTY, failureFor } from './notes';

describe('landing notes', () => {
  it('leaves the empty room to the link below the note', () => {
    expect(BAD_LINK).not.toMatch(/empty room/i);
    expect(EMPTY).not.toMatch(/empty room/i);
  });

  it('turns an unsupported link into the short note', () => {
    expect(failureFor(new ApiError(400, 'bad_url', 'this link is not supported'))).toEqual({ text: BAD_LINK, canStartRoom: true });
  });

  it('offers no new room when the limit is what stopped this one', () => {
    const failure = failureFor(new ApiError(429, 'rate_limited', 'Too many new rooms. Try again later.'));
    expect(failure).toEqual({ text: 'Too many new rooms. Try again later.', canStartRoom: false });
  });

  it('still offers an empty room after other failures', () => {
    expect(failureFor(new ApiError(0, 'network', 'Could not reach the server. Try again.')).canStartRoom).toBe(true);
    expect(failureFor(new Error('boom')).canStartRoom).toBe(true);
  });
});
