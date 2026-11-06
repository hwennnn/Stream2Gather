import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RoomSession, RoomView } from '../room/session';
import { Icon } from './Icon';

const EMOJI = ['😂', '❤️', '🔥', '😮', '👏', '😭'];

const SPARKS = [-1, -0.4, 0.4, 1];

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Rises up the right of the rail, in the gutter chat lines leave for their time,
 * so it crosses no one's words. It lives in the rail, so it can't reach the player.
 */
export const ReactionLane = ({ reactions }: { reactions: RoomView['reactions'] }) => (
  <div className="reaction-lane" aria-hidden="true">
    {reactions.map(({ id, emoji, name }) => (
      <span key={id} style={{ '--sway': `${((id * 37) % 21) - 10}px` } as CSSProperties} className="reaction">
        {SPARKS.map((spread) => (
          <span key={spread} style={{ '--spread': spread } as CSSProperties} className="reaction-spark">
            {emoji}
          </span>
        ))}
        <span className="reaction-emoji">{emoji}</span>
        <span className="reaction-name">{firstName(name)}</span>
      </span>
    ))}
  </div>
);

/** Theatre mode hides the rail, so the bar keeps the last few, in a row of their own. */
export const ReactionTicker = ({ reactions }: { reactions: RoomView['reactions'] }) => (
  <div className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden" aria-hidden="true">
    {reactions.slice(-3).map(({ id, emoji, name }) => (
      <span key={id} className="chip enter text-text">
        <span className="text-base leading-none">{emoji}</span>
        {firstName(name)}
      </span>
    ))}
  </div>
);

export const ReactionBar = ({ session, disabled, className }: { session: RoomSession; disabled: boolean; className: string }) => (
  <div className={`shrink-0 ${className}`}>
    {EMOJI.map((emoji) => (
      <button
        key={emoji}
        type="button"
        aria-label={`React ${emoji}`}
        disabled={disabled}
        onClick={() => session.send('react', { emoji })}
        className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-[19px] transition hover:scale-110 hover:bg-white/[0.08] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-transparent"
      >
        {emoji}
      </button>
    ))}
  </div>
);

/** Where the bar is short of room, reactions wait behind one button next to the chat box. */
export const ReactionPicker = ({ session, disabled }: { session: RoomSession; disabled: boolean }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent | KeyboardEvent) => {
      const outside = event instanceof PointerEvent && !root.current?.contains(event.target as Node);
      if (outside || (event instanceof KeyboardEvent && event.key === 'Escape')) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={root} className="hidden shrink-0 max-xl:block">
      {open && (
        <div className="enter absolute inset-x-3 bottom-full z-30 mb-1 flex justify-between rounded-xl border border-line bg-raised p-1 shadow-2xl">
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => session.send('react', { emoji })}
              className="flex size-11 cursor-pointer items-center justify-center rounded-lg text-[22px] active:bg-white/10"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label="Send a reaction"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="btn btn-quiet btn-icon"
      >
        <Icon name="smile" className="size-5" />
      </button>
    </div>
  );
};
