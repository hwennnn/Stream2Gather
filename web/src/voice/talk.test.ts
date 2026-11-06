// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushToTalk } from './talk';

const key = (type: string, init: KeyboardEventInit = {}) => new KeyboardEvent(type, { key: 'v', bubbles: true, ...init });

describe('PushToTalk', () => {
  const changes: boolean[] = [];
  let talk: PushToTalk;
  let detach: () => void;

  beforeEach(() => {
    changes.length = 0;
    talk = new PushToTalk((talking) => changes.push(talking));
    detach = talk.attach();
  });
  afterEach(() => {
    detach();
    vi.restoreAllMocks();
  });

  it('talks while the key is held, and ignores the key repeating', () => {
    window.dispatchEvent(key('keydown'));
    window.dispatchEvent(key('keydown', { repeat: true }));
    window.dispatchEvent(key('keyup'));
    expect(changes).toEqual([true, false]);
  });

  it('keeps talking until both the key and the button are let go', () => {
    talk.press('pointer');
    window.dispatchEvent(key('keydown'));
    window.dispatchEvent(key('keyup'));
    expect(changes).toEqual([true]);
    window.dispatchEvent(new Event('pointerup'));
    expect(changes).toEqual([true, false]);
  });

  it.each([
    ['blur', () => window.dispatchEvent(new Event('blur'))],
    ['pointercancel', () => window.dispatchEvent(new Event('pointercancel'))],
    [
      'visibilitychange',
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
  ])('lets go on %s', (_name, happen) => {
    talk.press('pointer');
    window.dispatchEvent(key('keydown'));
    happen();
    expect(changes).toEqual([true, false]);
  });

  it('ignores the key while typing, and with a modifier', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(key('keydown'));
    input.remove();
    window.dispatchEvent(key('keydown', { metaKey: true }));
    expect(changes).toEqual([]);
  });

  it('lets go when it stops listening', () => {
    talk.press('pointer');
    detach();
    expect(changes).toEqual([true, false]);
    window.dispatchEvent(key('keydown'));
    expect(changes).toEqual([true, false]);
    detach = () => {};
  });
});
