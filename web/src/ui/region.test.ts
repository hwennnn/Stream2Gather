import { describe, expect, it } from 'vitest';
import { viewerRegion } from './region';

describe('viewerRegion', () => {
  it('reads the region from a language tag', () => {
    expect(viewerRegion('en-SG')).toBe('SG');
    expect(viewerRegion('zh-Hant-TW')).toBe('TW');
  });

  // The server takes two capital letters and ignores the rest.
  it('leaves a tag without a region for the server to ignore', () => {
    expect(viewerRegion('en')).toBe('en');
  });
});
