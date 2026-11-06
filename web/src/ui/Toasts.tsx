import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RoomSession, RoomView } from '../room/session';
import { canControl, isOffline } from './rules';

const LIFE_MS = 4000;
const MAX_SHOWN = 3;

type Local = { text: string; count: number };

/** Shows a failed action's own words, for use as a catch handler. */
export const toastError = (onToast: (text: string) => void) => (error: unknown) => {
  if (error instanceof Error) onToast(error.message);
};

/** Short-lived messages from this page. Saying the same thing again only extends it. */
export const useToasts = () => {
  const [toasts, setToasts] = useState<Local[]>([]);
  const timers = useRef(new Map<string, number>());

  const toast = useCallback((text: string) => {
    window.clearTimeout(timers.current.get(text));
    timers.current.set(
      text,
      window.setTimeout(() => {
        timers.current.delete(text);
        setToasts((list) => list.filter((entry) => entry.text !== text));
      }, LIFE_MS),
    );
    setToasts((list) => {
      const found = list.find((entry) => entry.text === text);
      if (!found) return [...list, { text, count: 1 }];
      return [...list.filter((entry) => entry !== found), { text, count: found.count + 1 }];
    });
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return { toasts, toast };
};

type Shown = { text: string; count: number; url?: string };

const merge = (toasts: Local[], notices: RoomView['notices']): Shown[] => {
  const byText = new Map<string, Shown>();
  for (const notice of notices) {
    const found = byText.get(notice.text);
    byText.set(notice.text, { text: notice.text, url: notice.url, count: (found?.count ?? 0) + 1 });
  }
  for (const { text, count } of toasts) {
    const found = byText.get(text);
    byText.set(text, { ...found, text, count: (found?.count ?? 0) + count });
  }
  return [...byText.values()].slice(-MAX_SHOWN);
};

type StackProps = { toasts: Local[]; notices: RoomView['notices']; limit?: number; className: string; children?: ReactNode };

/** Lives in the rail, or in the bar in theatre mode. Never over the player. */
export const ToastStack = ({ toasts, notices, limit = MAX_SHOWN, className, children }: StackProps) => (
  <div aria-live="polite" className={`pointer-events-none z-20 flex flex-col items-center gap-2 ${className}`}>
    {merge(toasts, notices)
      .slice(-limit)
      .map(({ text, count, url }) => (
        <p key={text} className="enter float pointer-events-auto max-w-full px-3 py-2 text-[13px] leading-[18px]">
          {text}
          {count > 1 && <span className="text-muted"> ×{count}</span>}
          {url && (
            <>
              {' '}
              <a href={url} target="_blank" rel="noreferrer noopener" className="text-link underline underline-offset-2">
                Open on YouTube
              </a>
            </>
          )}
        </p>
      ))}
    {children}
  </div>
);

type JumpProps = { session: RoomSession; view: RoomView; onToast: (text: string) => void };

/** Says who changed the video for everyone, and gives the room five seconds to say no. */
export const JumpToast = ({ session, view, onToast }: JumpProps) => {
  const { jump } = view;
  if (!jump) return null;
  const who = jump.by === view.self?.name ? 'You' : jump.by;
  return (
    <p key={jump.id} className="enter float pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden py-2 pr-2 pl-3 text-[13px] leading-[18px]">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{who}</span> jumped to {jump.title}
      </span>
      {canControl(view) && (
        <button
          type="button"
          disabled={isOffline(view)}
          onClick={() => void session.undoJump(jump.id).catch(() => onToast('Too late to undo that.'))}
          className="btn btn-quiet btn-sm"
        >
          Undo
        </button>
      )}
      <span aria-hidden="true" className="undo-clock absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary" />
    </p>
  );
};
