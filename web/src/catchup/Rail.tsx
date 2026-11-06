import { useLayoutEffect, useRef } from 'react';
import { formatTime } from '../ui/format';
import { firstName, hueOf } from '../ui/people';
import type { Moment } from './api';

const Line = ({ moment, firedAt }: { moment: Moment; firedAt?: number }) => (
  <li data-pos={moment.posMs} data-fired={firedAt} className={`grid grid-cols-[3rem_minmax(0,1fr)] py-1 text-sm ${firedAt === undefined ? '' : 'enter'}`}>
    <span className="fig text-dim">{formatTime(moment.posMs / 1000)}</span>
    <span className="[overflow-wrap:anywhere]">
      <span style={{ color: moment.userId ? hueOf(moment.userId) : undefined }} className="mr-1.5 font-semibold">
        {firstName(moment.author)}
      </span>
      {moment.emoji ?? moment.body}
    </span>
  </li>
);

type Props = { moments: Moment[]; fired: Map<number, number>; className: string };

/** What the crew did, up to where the video is now. */
export const Rail = ({ moments, fired, className }: Props) => {
  const list = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [moments.length]);

  return (
    <ol ref={list} aria-label="Reactions" className={`overflow-y-auto ${className}`}>
      {moments.map((moment) => (
        <Line key={moment.id} moment={moment} firedAt={fired.get(moment.id)} />
      ))}
    </ol>
  );
};
