import { ConnectionError, DisconnectReason } from 'livekit-client';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/http';
import { endCopy, joinCopy, micCopy } from './call';

describe('what a failed call says', () => {
  it('only blames the network when the server was there and media still failed', () => {
    expect(joinCopy(new ApiError(503, 'voice_unavailable', 'no'))).toBe('Voice unavailable');
    expect(joinCopy(ConnectionError.serverUnreachable('down'))).toBe('Voice unavailable');
    expect(joinCopy(ConnectionError.notAllowed('bad token', 401))).toBe('Voice unavailable');
    expect(joinCopy(ConnectionError.timeout('no media'))).toBe('Voice can’t connect on this network');
  });

  it('names a move to another tab, and stays quiet about an ordinary end', () => {
    expect(endCopy(DisconnectReason.DUPLICATE_IDENTITY)).toBe('Voice moved to another tab');
    expect(endCopy(DisconnectReason.PARTICIPANT_REMOVED)).toBe('You were removed from voice');
    expect(endCopy(DisconnectReason.SERVER_SHUTDOWN)).toBeNull();
    expect(endCopy(undefined)).toBeNull();
  });

  it('keeps listening as the way out of a mic failure', () => {
    expect(micCopy(new DOMException('no', 'NotAllowedError'))).toMatch(/blocked.*still listen/);
    expect(micCopy(new DOMException('no', 'NotFoundError'))).toBe('No microphone found. You can still listen.');
    expect(micCopy(new Error('odd'))).toMatch(/still listen/);
  });
});
