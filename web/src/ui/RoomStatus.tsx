import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '../room/session';
import { expectedPosition } from '../sync/controller';
import { hueOf } from './people';
import { actFor, statusFor, type Act, type Part } from './status';
import type { RoomPlayer } from './useRoomPlayer';

const ACT_MS = 4000;

/** The latest thing someone did, for as long as it's news. */
export const useLatestAct = (view: RoomView): Act | null => {
  const [act, setAct] = useState<Act | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seen = useRef<Map<string, string> | null>(null);
  const position = useRef(view.playback.pos);
  position.current = view.playback.pos;

  const say = (next: Act) => {
    window.clearTimeout(timer.current);
    setAct(next);
    timer.current = window.setTimeout(() => setAct(null), ACT_MS);
  };

  useEffect(() => {
    const next = actFor(view.lastAction, position.current);
    if (next) say(next);
  }, [view.lastAction]);

  useEffect(() => {
    const before = seen.current;
    const now = new Map(view.members.map((person) => [person.userId, person.name]));
    seen.current = now;
    if (!before) return;
    for (const [id, name] of now) if (!before.has(id)) say({ by: name, text: 'took a seat' });
    for (const [id, name] of before) if (!now.has(id)) say({ by: name, text: 'stepped out' });
  }, [view.members]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return act;
};

const useTick = (running: boolean) => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => tick((count) => count + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
};

const Piece = ({ part }: { part: Part }) => {
  if (typeof part === 'string') return part;
  if ('fig' in part) return <span className="fig text-[13px]">{part.fig}</span>;
  return (
    <span style={part.userId ? { color: hueOf(part.userId) } : undefined} className="font-semibold">
      {part.who}
    </span>
  );
};

type Props = { view: RoomView; player: RoomPlayer; act: Act | null };

/** One line, always in the same place, that says what the room is doing and who did it. */
export const RoomStatus = ({ view, player, act }: Props) => {
  const playing = view.playback.status === 'playing';
  useTick(playing);
  const position = playing ? expectedPosition(view.playback, Date.now()) : view.playback.pos;
  const { parts, tone } = statusFor({ view, health: player.report.health, failed: player.failure !== null, act, position });
  return (
    <p className={`truncate text-[13px] leading-5 ${tone === 'warn' ? 'text-warn' : 'text-muted'}`}>
      {parts.map((part, index) => (
        <Piece key={index} part={part} />
      ))}
    </p>
  );
};

const STILL_TRYING_MS = 30_000;

/** Takes the place of the status line, so a dropped connection moves nothing. */
export const OfflineNote = ({ elapsed, onRetry }: { elapsed: number; onRetry: () => void }) => {
  const long = elapsed >= STILL_TRYING_MS;
  return (
    <p role="status" className="flex items-center gap-2 truncate text-[13px] leading-5 text-warn">
      {long ? 'Still trying. Check your connection.' : 'Reconnecting. The video keeps playing.'}
      {long && (
        <button type="button" onClick={onRetry} className="shrink-0 cursor-pointer text-text underline underline-offset-2">
          Try again
        </button>
      )}
    </p>
  );
};
