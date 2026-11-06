import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColor } from './format';
import { hueOf, seatHues } from './people';

const sameColour = (count: number, prefix: string): string[] => {
  const first = `${prefix}0`;
  const ids = [first];
  for (let index = 1; ids.length < count; index += 1) {
    if (avatarColor(`${prefix}${index}`) === avatarColor(first)) ids.push(`${prefix}${index}`);
  }
  return ids;
};

describe('seatHues', () => {
  it('never repeats a hue in a room, even for people who hash alike', () => {
    const room = sameColour(AVATAR_COLORS.length, 'a');
    seatHues(room);
    expect(new Set(room.map((id) => hueOf(id))).size).toBe(room.length);
  });

  it('keeps a hue as people come and go', () => {
    const [maya = '', sam = '', ada = ''] = sameColour(3, 'b');
    seatHues([maya, sam]);
    const hue = hueOf(sam);
    seatHues([maya, sam, ada]);
    seatHues([sam, ada]);
    expect(hueOf(sam)).toBe(hue);
  });

  it('settles a clash when someone comes back to a hue that was given away', () => {
    const [left = '', stayed = ''] = sameColour(2, 'c');
    seatHues([left]);
    seatHues([stayed]);
    seatHues([stayed, left]);
    expect(hueOf(left)).not.toBe(hueOf(stayed));
  });

  it('falls back to the hash for someone it has never seated', () => {
    expect(hueOf('d-never')).toBe(avatarColor('d-never'));
  });
});
