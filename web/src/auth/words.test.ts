import { describe, expect, it } from 'vitest';
import { clerkWords, joinCrewAsk, SIGN_IN } from './words';

describe('sign-in words', () => {
  it('replaces every greeting Clerk could open with, on both ways in', () => {
    const words = clerkWords(joinCrewAsk('Sundays'));
    for (const start of [words.signIn.start, words.signUp.start]) {
      expect(start.title).toBe('Join Sundays');
      expect(start.titleCombined).toBe('Join Sundays');
      expect(start.subtitle).toMatch(/seat in the crew/);
      expect(start.subtitleCombined).toBe(start.subtitle);
    }
  });

  it('never assumes someone has been here before', () => {
    expect(JSON.stringify(clerkWords(SIGN_IN))).not.toMatch(/welcome back/i);
    expect(SIGN_IN.subtitle).toMatch(/new here/i);
  });
});
