import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from '../room/session';

const LIFE_MS = 4000;
const MAX_SHOWN = 3;

type Local = { text: string; count: number };

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

type StackProps = { toasts: Local[]; notices: RoomView['notices']; limit?: number; className: string };

/** Lives in the rail, or in the bar in theatre mode. Never over the player. */
export const ToastStack = ({ toasts, notices, limit = MAX_SHOWN, className }: StackProps) => (
  <div aria-live="polite" className={`pointer-events-none z-20 flex flex-col items-center gap-2 ${className}`}>
    {merge(toasts, notices)
      .slice(-limit)
      .map(({ text, count, url }) => (
        <p key={text} className="enter pointer-events-auto max-w-full rounded-xl border border-line bg-raised px-3.5 py-2 text-[13px] leading-snug shadow-xl">
          {text}
          {count > 1 && <span className="text-muted"> ×{count}</span>}
          {url && (
            <>
              {' '}
              <a href={url} target="_blank" rel="noreferrer noopener" className="text-accent underline-offset-2 hover:underline">
                Open on YouTube
              </a>
            </>
          )}
        </p>
      ))}
  </div>
);
