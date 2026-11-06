import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { badLink, emptyNote, failureFor, linkKinds, youtubeId } from './notes';

describe('landing notes', () => {
  it('leaves the empty room to the link below the note', () => {
    expect(badLink('YouTube')).not.toMatch(/empty room/i);
    expect(emptyNote('YouTube')).not.toMatch(/empty room/i);
  });

  it('turns an unsupported link into the short note', () => {
    expect(failureFor(new ApiError(422, 'media', 'That link is not supported yet.'), 'YouTube')).toEqual({ text: 'That isn’t a YouTube link.', canStartRoom: true });
  });

  it('offers no new room when the limit is what stopped this one', () => {
    const failure = failureFor(new ApiError(429, 'rate_limited', 'Too many new rooms. Try again later.'), 'YouTube');
    expect(failure).toEqual({ text: 'Too many new rooms. Try again later.', canStartRoom: false });
  });

  it('still offers an empty room after other failures', () => {
    expect(failureFor(new ApiError(0, 'network', 'Could not reach the server. Try again.'), 'YouTube').canStartRoom).toBe(true);
    expect(failureFor(new Error('boom'), 'YouTube').canStartRoom).toBe(true);
  });

  it('finds the video in every way of writing a YouTube link', () => {
    for (const link of ['https://youtu.be/dQw4w9WgXcQ', 'youtu.be/dQw4w9WgXcQ?t=3', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/watch?t=30s&v=dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'www.youtube.com/embed/dQw4w9WgXcQ']) {
      expect(youtubeId(link)).toBe('dQw4w9WgXcQ');
    }
  });

  it('finds nothing in anything else', () => {
    for (const text of ['cats playing piano', 'https://vimeo.com/76979871', 'https://youtu.be/short', 'https://www.youtube.com/watch?v=waytoolongtobeanid']) expect(youtubeId(text)).toBeNull();
  });

  it('names only the sources this server has on', () => {
    expect(linkKinds()).toBe('YouTube');
    expect(linkKinds(['youtube', 'direct'])).toBe('YouTube');
    expect(linkKinds(['youtube', 'twitch'])).toBe('YouTube or Twitch');
    expect(linkKinds(['twitch', 'youtube', 'vimeo'])).toBe('YouTube, Vimeo or Twitch');
  });
});
