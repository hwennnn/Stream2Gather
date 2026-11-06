import { useEffect, useState } from 'react';
import { formatTime } from '../../ui/format';
import { Thumb } from '../../ui/Thumb';

export const CHAT = [
  { name: 'Maya', color: '#8fa8ff', text: 'wait for this part' },
  { name: 'Sam', color: '#5eead4', text: 'no spoilers!!' },
  { name: 'Priya', color: '#f0abfc', text: 'okay that was incredible' },
];

const START_S = 754;

/** Counts up like a video. Both screens read it, because that's the whole idea. */
const useTimeline = () => {
  const [seconds, setSeconds] = useState(START_S);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return formatTime(seconds);
};

const Bar = ({ time }: { time: string }) => (
  <div className="flex items-center gap-2 text-[11px] font-medium text-text tabular-nums">
    <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
      <span className="block h-full w-[62%] rounded-full bg-linear-to-r from-sky to-violet" />
    </span>
    {time}
  </div>
);

/** An illustration of a room. It's a picture, so nothing here is a real player. */
export const HeroPreview = ({ thumbnail, title }: { thumbnail: string; title: string }) => {
  const time = useTimeline();

  return (
    <div aria-hidden="true" className="relative min-w-0 select-none phone:mx-1">
      <div className="hero-halo" />

      <div className="relative overflow-hidden rounded-2xl border border-line bg-panel/90 shadow-2xl shadow-black/40">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <img src="/favicon.svg" alt="" className="size-4" />
          <span className="text-xs font-semibold">Friday movie night</span>
          <span className="ml-auto flex -space-x-1.5">
            {CHAT.map((person) => (
              <span
                key={person.name}
                style={{ background: person.color }}
                className="flex size-5 items-center justify-center rounded-full text-[9px] font-bold text-ink ring-2 ring-panel"
              >
                {person.name[0]}
              </span>
            ))}
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_38%] phone:grid-cols-1">
          <div className="min-w-0 p-3">
            <Thumb src={thumbnail} className="w-full rounded-lg" />
            <div className="mt-2.5 px-0.5">
              <p className="truncate text-[13px] font-semibold">{title}</p>
              <div className="mt-2">
                <Bar time={time} />
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 border-l border-line p-3.5 phone:hidden">
            {CHAT.map((message, index) => (
              <p key={message.name} className="hero-line text-[12px] leading-snug" style={{ animationDelay: `${index * 0.9}s` }}>
                <span style={{ color: message.color }} className="font-semibold">
                  {message.name}
                </span>
                <br />
                <span className="text-muted">{message.text}</span>
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="hero-float absolute -right-3 -bottom-12 w-40 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/50 lg:-right-3 phone:hidden land:hidden">
        <Thumb src={thumbnail} className="w-full" />
        <div className="p-2.5">
          <Bar time={time} />
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <span className="size-1.5 rounded-full bg-good" />
            On Sam’s phone
          </p>
        </div>
      </div>
    </div>
  );
};
