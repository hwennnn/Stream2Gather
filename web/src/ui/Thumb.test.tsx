// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { rowImage, Thumb } from './Thumb';

const full = 'https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg';
const row = 'https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg';

describe('rowImage', () => {
  it('swaps any YouTube size for the 320px one', () => {
    expect(rowImage(full)).toBe(row);
    expect(rowImage('https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg')).toBe(row);
    expect(rowImage('https://i.ytimg.com/vi/aqz-KE-bpKQ/sddefault.jpg')).toBe(row);
  });

  it('keeps a live stream on its own image', () => {
    expect(rowImage('https://i.ytimg.com/vi/abc/hqdefault_live.jpg')).toBe('https://i.ytimg.com/vi/abc/mqdefault_live.jpg');
  });

  it('leaves everything else alone', () => {
    expect(rowImage('https://i.vimeocdn.com/video/1_default.jpg')).toBe('https://i.vimeocdn.com/video/1_default.jpg');
    expect(rowImage('')).toBe('');
  });
});

describe('Thumb', () => {
  afterEach(cleanup);

  it('asks for the small image unless it is drawn large', () => {
    const { container, rerender } = render(<Thumb src={full} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(row);
    rerender(<Thumb src={full} large />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(full);
  });

  it('falls back to the placeholder when the image fails', () => {
    const { container } = render(<Thumb src={full} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
  });
});
