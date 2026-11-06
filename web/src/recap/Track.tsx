import type { ReactNode } from 'react';
import type { Dot } from './night';

/** The room's track, kept: a hairline through a video, and a dot in someone's colour wherever they reacted. */
export const Track = ({ dots, children }: { dots: Dot[]; children?: ReactNode }) => (
  <span aria-hidden="true" className="seat-track-line night-line">
    {dots.map(({ left, color }, index) => (
      <span key={index} style={{ left: `${left}%`, backgroundColor: color }} className="seat-track-dot" />
    ))}
    {children}
  </span>
);
