import { useEffect, useRef, useState } from 'react';
import type { RoomSession } from '../room/session';
import { Icon } from './Icon';

export const EMOJI = ['😂', '❤️', '🔥', '😮', '👏', '😭'];

export const ReactionBar = ({ session, disabled, className }: { session: RoomSession; disabled: boolean; className: string }) => (
  <div className={`shrink-0 ${className}`}>
    {EMOJI.map((emoji) => (
      <button
        key={emoji}
        type="button"
        aria-label={`React ${emoji}`}
        disabled={disabled}
        onClick={() => session.react(emoji)}
        className="react flex size-9 cursor-pointer items-center justify-center rounded-md text-[20px] disabled:cursor-not-allowed"
      >
        {emoji}
      </button>
    ))}
  </div>
);

/** Wherever the row beside the seats won't fit, reactions wait behind one button next to the chat box. */
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
    <div ref={root} className="shrink-0 xl:hidden land:block">
      {open && (
        <div className="enter float absolute inset-x-3 bottom-full z-30 mb-1 flex justify-between p-1">
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => session.react(emoji)}
              className="flex size-11 cursor-pointer items-center justify-center rounded-md text-[22px] active:bg-raised"
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
        className="btn btn-ghost btn-icon"
      >
        <Icon name="smile" className="size-5" />
      </button>
    </div>
  );
};
