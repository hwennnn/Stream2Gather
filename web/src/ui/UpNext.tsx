import { useEffect, useRef, useState } from 'react';
import type { RoomSession, RoomView } from '../room/session';
import { canControl, canQueue, isOffline } from './rules';
import { Thumb } from './Thumb';
import { toastError } from './Toasts';

const GAP = 8;
const TILE = 96;
const STACK_FROM = 180;
/** What a standing card spends on its padding, title and name, in pixels. */
const CARD_TEXT = 96;

type Strip = { shown: number; more: number; widest: number; stacked: boolean };

/** Sizes the row to the space the player leaves. Every video is either a card or counted. */
export const planStrip = (total: number, width: number, height: number): Strip => {
  const stacked = height >= STACK_FROM;
  // A standing card can't be wider than its thumbnail is allowed to be tall.
  const widest = stacked ? ((height - CARD_TEXT) * 16) / 9 : 416;
  const card = stacked ? Math.min(widest, 220) : height >= 150 ? 272 : 216;
  const fit = (room: number) => Math.floor((room + GAP) / (card + GAP));
  if (fit(width) >= total) return { shown: total, more: 0, widest, stacked };
  const shown = Math.max(fit(width - TILE - GAP), 1);
  return { shown, more: total - shown, widest, stacked };
};

const useSize = () => {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
};

type UpNextProps = {
  session: RoomSession;
  view: RoomView;
  onPickAnother: () => void;
  onShowQueue: () => void;
  onToast: (text: string) => void;
};

/** Fills the height the player doesn't need. Hides itself when there's too little. */
export const UpNext = ({ session, view, onPickAnother, onShowQueue, onToast }: UpNextProps) => {
  const upcoming = view.queue.slice(1);
  const playable = canControl(view) && !isOffline(view);
  const { ref, width, height } = useSize();
  // The heading and the padding around the cards are not the cards' to use.
  const strip = planStrip(upcoming.length, width - 108, height);
  const tracks = `repeat(${strip.shown}, minmax(0, ${strip.widest}px))${strip.more > 0 ? ` ${TILE}px` : ''}`;

  return (
    <section ref={ref} aria-label="Up next in the queue" className="up-next">
      <div className="up-next-inner h-full items-center gap-3 border-t border-line px-4 py-3">
        <h3 className="w-16 shrink-0 text-[13px] leading-snug font-semibold">Up next</h3>
        {upcoming.length === 0 ? (
          <p className="flex min-w-0 flex-1 items-center gap-3 text-[13px] text-muted">
            Nothing queued.
            {canQueue(view) && (
              <button type="button" onClick={onPickAnother} className="btn btn-quiet btn-sm">
                Add a video
              </button>
            )}
          </p>
        ) : (
          <ol data-stacked={strip.stacked} style={{ gridTemplateColumns: tracks }} className="up-next-cards">
            {upcoming.slice(0, strip.shown).map((item) => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  disabled={!playable}
                  title={playable ? `Play ${item.title} now` : item.title}
                  onClick={() => void session.request('queue.play', { target: item.id }).catch(toastError(onToast))}
                  className="up-next-card flex w-full items-center gap-2.5 rounded-lg p-1 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-white/[0.05]"
                >
                  <Thumb src={item.thumbnailUrl} className="up-next-thumb w-24 rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] leading-snug font-medium">{item.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{item.addedByName}</span>
                  </span>
                </button>
              </li>
            ))}
            {strip.more > 0 && (
              <li>
                <button
                  type="button"
                  onClick={onShowQueue}
                  aria-label={`${strip.more} more in the queue`}
                  className="flex size-full min-h-14 cursor-pointer items-center justify-center rounded-lg bg-white/[0.05] text-[13px] font-semibold transition-colors hover:bg-white/[0.1]"
                >
                  +{strip.more} more
                </button>
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
};
