import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '../room/session';
import { expectedPosition } from '../sync/controller';
import { hueOf } from './people';
import { actFor, laggingFriend, statusFor, type Act, type Part } from './status';
import { useSyncReport, type RoomPlayer } from './useRoomPlayer';

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

export const useTick = (running: boolean) => {
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
    <span style={part.userId ? { color: hueOf(part.userId) } : undefined} className="font-semibold whitespace-nowrap">
      {part.who}
    </span>
  );
};

/** Below this, a stall or a gap clears by itself and saying so would only be noise. */
const HOLD_MS = 2000;

/** True once `on` has held for HOLD_MS. A new `key` starts the wait again. */
const useHeld = (on: boolean, key: string | undefined): boolean => {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    setHeld(false);
    if (!on) return undefined;
    const timer = window.setTimeout(() => setHeld(true), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [on, key]);
  return on && held;
};

type Props = {
  view: RoomView;
  player: RoomPlayer;
  act: Act | null;
  offlineFor: number | null;
  onRetry: () => void;
  /** Just the first clause, where a sideways phone has no bar to hold the sentence. */
  compact?: boolean;
  className?: string;
};

/** The room's state, in the one fixed slot that shows it. Nothing else may word it for itself. */
export const RoomStatus = ({ view, player, act, offlineFor, onRetry, compact = false, className = '' }: Props) => {
  const playing = view.playback.status === 'playing';
  useTick(playing);
  const position = playing ? expectedPosition(view.playback, Date.now()) : view.playback.pos;
  const { health } = useSyncReport(player);
  const item = view.playback.item;
  const friend = laggingFriend(view);
  const slow = useHeld(playing && !player.started, item);
  const gap = useHeld(playing && player.started && (health === 'correcting' || health === 'buffering'), item);
  const friendGap = useHeld(friend !== undefined, friend?.userId);
  const failed = player.failure !== null;
  const { state, parts, tail, tone, retry } = statusFor({ view, health, failed, act, position, started: player.started, slow, gap, friendGap, offlineFor, refused: player.refused, live: view.queue[0]?.isLive });
  return (
    <p data-room-status={state} role={state === 'offline' ? 'status' : undefined} className={`flex min-w-0 items-center gap-2 text-[13px] leading-5 ${tone === 'warn' ? 'text-warn' : 'text-muted'} ${className}`}>
      <span className="truncate">
        {parts.map((part, index) => (
          <Piece key={index} part={part} />
        ))}
        {!compact && tail}
      </span>
      {retry && (
        <button type="button" onClick={onRetry} className="shrink-0 cursor-pointer text-text underline underline-offset-2">
          Try again
        </button>
      )}
    </p>
  );
};
