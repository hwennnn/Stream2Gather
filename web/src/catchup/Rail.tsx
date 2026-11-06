import { useLayoutEffect, useRef } from 'react';
import { formatTime } from '../ui/format';
import { firstName } from '../ui/people';
import type { Moment } from './api';

const Line = ({ moment, firedAt }: { moment: Moment; firedAt?: number }) => (
  <li data-pos={moment.posMs} data-fired={firedAt} className={firedAt === undefined ? 'py-1 text-sm' : 'enter py-1 text-sm'}>
    <span className="text-muted">
      {firstName(moment.author)}, <span className="fig text-[13px]">{formatTime(moment.posMs / 1000)}</span>,
    </span>{' '}
    {moment.emoji ?? moment.body}
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
