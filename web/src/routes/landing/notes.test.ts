import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { badLink, emptyNote, failureFor, linkKinds } from './notes';

describe('landing notes', () => {
  it('leaves the empty room to the link below the note', () => {
    expect(badLink('YouTube')).not.toMatch(/empty room/i);
    expect(emptyNote('YouTube')).not.toMatch(/empty room/i);
  });

  it('turns an unsupported link into the short note', () => {
    expect(failureFor(new ApiError(400, 'bad_url', 'That link is not supported yet.'), 'YouTube')).toEqual({ text: 'That isn’t a YouTube link.', canStartRoom: true });
  });

  it('offers no new room when the limit is what stopped this one', () => {
    const failure = failureFor(new ApiError(429, 'rate_limited', 'Too many new rooms. Try again later.'), 'YouTube');
    expect(failure).toEqual({ text: 'Too many new rooms. Try again later.', canStartRoom: false });
  });

  it('still offers an empty room after other failures', () => {
    expect(failureFor(new ApiError(0, 'network', 'Could not reach the server. Try again.'), 'YouTube').canStartRoom).toBe(true);
    expect(failureFor(new Error('boom'), 'YouTube').canStartRoom).toBe(true);
  });

  it('names only the sources this server has on', () => {
    expect(linkKinds()).toBe('YouTube');
    expect(linkKinds(['youtube', 'direct'])).toBe('YouTube');
    expect(linkKinds(['youtube', 'twitch'])).toBe('YouTube or Twitch');
    expect(linkKinds(['twitch', 'youtube', 'vimeo'])).toBe('YouTube, Vimeo or Twitch');
  });
});
