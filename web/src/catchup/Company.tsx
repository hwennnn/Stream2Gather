import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { firstName } from '../ui/people';
import type { Moment } from './api';

/** Long enough to read, and short enough that the next one lands on a quiet seat. */
const LIT_MS = 1600;
const SEATS = 8;

const whoMade = ({ userId, author }: Moment): string => userId ?? author;

/** Everyone who left something here, in the order the video reaches them, without whoever's watching. */
const peopleIn = (moments: Moment[], selfId?: string): Moment[] => {
  const seen = new Map<string, Moment>();
  for (const moment of moments) {
    if (moment.userId !== undefined && moment.userId === selfId) continue;
    if (!seen.has(whoMade(moment))) seen.set(whoMade(moment), moment);
  }
  return [...seen.values()];
};

type Props = { moments: Moment[]; passed: Moment[]; fired: Map<number, number>; selfId?: string };

/** The people who watched this before you, sitting under the screen. Each lights up when the video reaches them. */
export const Company = ({ moments, passed, fired, selfId }: Props) => {
  const [lit, setLit] = useState(new Map<string, Moment>());
  const seen = useRef(0);
  const people = peopleIn(moments, selfId);

  useEffect(() => {
    const reached = passed.slice(seen.current).filter(({ id }) => fired.has(id));
    seen.current = passed.length;
    if (reached.length === 0) return undefined;
    setLit(new Map(reached.map((moment) => [whoMade(moment), moment])));
    const timer = window.setTimeout(() => setLit(new Map()), LIT_MS);
    return () => window.clearTimeout(timer);
  }, [fired, passed]);

  if (people.length === 0) return null;
  return (
    <ul aria-label="Who watched this" data-kept="true" className="seats mt-3">
      {people.slice(0, SEATS).map((person) => {
        const moment = lit.get(whoMade(person));
        return (
          <li key={whoMade(person)} data-away={moment === undefined} className="seat">
            <span className="seat-disc">
              <Avatar person={{ userId: person.userId ?? '', name: person.author }} labelled={false} className="size-full" />
              {moment?.emoji && <span className="seat-reaction">{moment.emoji}</span>}
            </span>
            <span className="seat-name">{firstName(person.author)}</span>
          </li>
        );
      })}
      {people.length > SEATS && (
        <li className="seat">
          <span className="seat-more">+{people.length - SEATS}</span>
        </li>
      )}
    </ul>
  );
};
