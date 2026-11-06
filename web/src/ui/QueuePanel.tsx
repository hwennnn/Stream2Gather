import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { formatTime, plural } from './format';
import { Icon, type IconName } from './Icon';
import { AddBox, MediaRow, MediaSkeleton, SearchResults, useSearch } from './Omnibox';
import { followPointer } from './pointerDrag';
import { canControl, canQueue, isOffline } from './rules';
import { sourceName } from './sources';
import { Thumb } from './Thumb';
import { toastError } from './Toasts';
import { useAdder } from './useAdder';
import { useTrending } from './useTrending';

type Props = { session: RoomSession; view: RoomView; onToast: (text: string) => void };

const summary = (items: QueueItem[]): string => {
  const parts = [plural(items.length, 'video')];
  const known = items.every((item) => item.durationMs > 0);
  if (known && items.length > 0) parts.push(formatTime(items.reduce((sum, item) => sum + item.durationMs, 0) / 1000));
  return parts.join(' · ');
};

export const QueuePanel = ({ session, view, onToast }: Props) => {
  const adder = useAdder(session, view);
  const search = useSearch(adder);
  const trending = useTrending();
  const editable = canQueue(view);
  const current = view.queue[0];
  const upcoming = view.queue.slice(1);

  // The stage is showing search and trending, so saying them twice helps nobody.
  if (!current) {
    return (
      <p className="flex h-full items-center justify-center px-6 text-center text-sm text-balance text-muted">
        {editable ? 'The queue is empty. Pick something to start it.' : 'The queue is empty. The host picks what’s next.'}
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {editable ? (
        <div className="p-3 pb-2">
          <AddBox id="omnibox" search={search} adder={adder} />
        </div>
      ) : (
        <p className="flex items-center gap-2 px-4 pt-3 pb-1 text-[13px] text-muted">
          <Icon name="lock" className="size-3.5 shrink-0" />
          Only the host can change the queue.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {search.query !== null ? (
          <SearchResults search={search} adder={adder} />
        ) : (
          <>
            <NowPlaying item={current} paused={view.playback.status === 'paused'} />

            <section aria-label="Up next" className="mt-2">
              <h3 className="px-4 py-1.5 text-[13px] font-semibold">
                Up next
                {upcoming.length > 0 && <span className="font-normal text-muted"> · {summary(upcoming)}</span>}
              </h3>
              {upcoming.length === 0 ? (
                <p className="px-4 pb-2 text-[13px] text-muted">
                  {editable ? 'Nothing queued yet. Add something from below.' : 'Nothing queued yet.'}
                </p>
              ) : (
                <UpNextList session={session} view={view} items={upcoming} onToast={onToast} />
              )}
            </section>

            {editable && trending?.length !== 0 && (
              <section aria-label="Trending" className="mt-3">
                <h3 className="px-4 py-1.5 text-[13px] font-semibold">Trending</h3>
                {trending ? (
                  <ul className="px-1">
                    {trending.map((media) => (
                      <MediaRow key={media.sourceId} media={media} status={adder.statusOf(media)} onAdd={(mode) => void adder.addMedia(media, mode)} />
                    ))}
                  </ul>
                ) : (
                  <MediaSkeleton count={4} />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const NowPlaying = ({ item, paused }: { item: QueueItem; paused: boolean }) => (
  <section aria-label="Now playing">
    <h3 className="px-4 py-1.5 text-[13px] font-semibold">Now playing</h3>
    <div className="mx-2 flex items-center gap-3 rounded-xl bg-white/[0.05] p-2">
      <Thumb src={item.thumbnailUrl} className="w-20 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] leading-snug font-medium">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {paused ? 'Paused · ' : ''}
          {sourceName(item.source)} · Added by {item.addedByName}
        </p>
      </div>
    </div>
  </section>
);

type Drag = { id: string; from: number; to: number; dy: number; height: number };

type ListProps = { session: RoomSession; view: RoomView; items: QueueItem[]; onToast: Props['onToast'] };

const UpNextList = ({ session, view, items, onToast }: ListProps) => {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const stopDrag = useRef<(() => void) | null>(null);
  const editable = canQueue(view);

  // The server's answer always wins over the order shown while waiting for it.
  useEffect(() => setOrder(null), [view.queue]);

  // Someone else can take the row away, or the host the right to move it.
  const dragGone = drag !== null && (!editable || !items.some((item) => item.id === drag.id));
  useEffect(() => {
    if (!dragGone) return;
    stopDrag.current?.();
    stopDrag.current = null;
    setDrag(null);
  }, [dragGone]);

  useEffect(() => () => stopDrag.current?.(), []);

  const shown = order
    ? [...items].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    : items;

  const move = (item: QueueItem, to: number) => {
    const ids = shown.map((entry) => entry.id).filter((id) => id !== item.id);
    ids.splice(to, 0, item.id);
    setOrder(ids);
    setAnnouncement(`Moved ${item.title} to position ${to + 1}`);
    // The server counts the current video as index 0.
    session.queueMove(item.id, to + 1).catch((error: unknown) => {
      setOrder(null);
      toastError(onToast)(error);
    });
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, item: QueueItem, from: number) => {
    const rows = [...(list.current?.children ?? [])].map((row) => row.getBoundingClientRect());
    const own = rows[from];
    if (!own) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    let latest: Drag = { id: item.id, from, to: from, dy: 0, height: own.height };
    setDrag(latest);

    stopDrag.current = followPointer(event.pointerId, {
      onMove: (next) => {
        const dy = next.clientY - startY;
        const center = own.top + own.height / 2 + dy;
        const passed = rows.filter((row, index) => index !== from && row.top + row.height / 2 < center).length;
        latest = { ...latest, dy, to: passed };
        setDrag(latest);
      },
      onEnd: (commit) => {
        stopDrag.current = null;
        setDrag(null);
        if (commit && latest.to !== from) move(item, latest.to);
      },
    });
  };

  const offsetOf = (index: number): number => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < index && index <= drag.to) return -drag.height;
    if (drag.to <= index && index < drag.from) return drag.height;
    return 0;
  };

  return (
    <>
      <ol ref={list} className="px-1">
        {shown.map((item, index) => (
          <QueueRow
            key={item.id}
            item={item}
            index={index}
            last={index === shown.length - 1}
            offset={offsetOf(index)}
            dragging={drag?.id === item.id}
            settling={drag !== null}
            canPlay={canControl(view)}
            editable={editable}
            offline={isOffline(view)}
            onDragStart={(event) => startDrag(event, item, index)}
            onMove={(to) => move(item, to)}
            onPlay={() => void session.request('queue.play', { target: item.id }).catch(toastError(onToast))}
            onRemove={() => void session.queueRemove(item.id).catch(toastError(onToast))}
          />
        ))}
      </ol>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
};

type RowAction = {
  label: string;
  /** Icon-only on the row itself. Without one it shows its label. */
  icon?: IconName;
  primary?: boolean;
  /** Too rarely wanted to earn room on the row. */
  trayOnly?: boolean;
  disabled: boolean;
  run: () => void;
};

type RowProps = {
  item: QueueItem;
  index: number;
  last: boolean;
  offset: number;
  dragging: boolean;
  settling: boolean;
  canPlay: boolean;
  editable: boolean;
  offline: boolean;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onMove: (to: number) => void;
  onPlay: () => void;
  onRemove: () => void;
};

const QueueRow = (props: RowProps) => {
  const { item, index, last, offset, dragging, settling, canPlay, editable, offline } = props;
  const { onDragStart, onMove, onPlay, onRemove } = props;
  const [tray, setTray] = useState(false);
  const meta = [sourceName(item.source), `Added by ${item.addedByName}`, item.durationMs > 0 ? formatTime(item.durationMs / 1000) : ''].filter(Boolean).join(' · ');
  const actions: RowAction[] = [
    ...(canPlay ? [{ label: 'Play now', primary: true, disabled: offline, run: onPlay }] : []),
    ...(editable
      ? [
          { label: 'Play next', trayOnly: true, disabled: index === 0 || offline, run: () => onMove(0) },
          { label: 'Move up', icon: 'up' as const, disabled: index === 0 || offline, run: () => onMove(index - 1) },
          { label: 'Move down', icon: 'down' as const, disabled: last || offline, run: () => onMove(index + 1) },
          { label: 'Remove', icon: 'close' as const, disabled: offline, run: onRemove },
        ]
      : []),
  ];

  return (
    <li
      style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
      className={`row relative rounded-xl py-1.5 pr-2 pl-1 ${settling && !dragging ? 'transition-transform duration-150' : ''} ${
        dragging ? 'z-10 bg-raised shadow-2xl' : 'hover:bg-white/[0.04]'
      }`}
    >
      {/* Touch only. Opens the same tray as the ⋯ button, which is the one a screen reader gets. */}
      {(canPlay || editable) && (
        <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setTray(!tray)} className="row-tap absolute inset-0 rounded-xl" />
      )}
      <div className="flex items-center gap-1.5">
        {editable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onPointerDown={onDragStart}
            className="relative flex h-11 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted/60 hover:text-text active:cursor-grabbing"
          >
            <Icon name="grip" />
          </button>
        ) : (
          <span className="w-1.5 shrink-0" />
        )}
        <Thumb src={item.thumbnailUrl} className="w-20 rounded-md" />
        <div className="min-w-0 flex-1 pl-1.5">
          <p className="line-clamp-2 text-[13px] leading-snug font-medium">{item.title}</p>
          <div className="relative mt-0.5 min-h-[26px]">
            <p className="row-meta truncate text-xs leading-[26px] text-muted transition-opacity">{meta}</p>
            <div className="row-actions absolute inset-0 flex items-center gap-1 transition-opacity">
              {actions
                .filter((action) => !action.trayOnly)
                .map(({ label, icon, primary, disabled, run }) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={`${label}: ${item.title}`}
                    disabled={disabled}
                    onClick={run}
                    className={`btn btn-sm ${primary ? 'btn-primary' : 'btn-quiet'} ${icon ? 'btn-icon' : ''}`}
                  >
                    {icon ? <Icon name={icon} className="size-3.5" /> : label}
                  </button>
                ))}
            </div>
          </div>
        </div>
        {(canPlay || editable) && (
          <button type="button" aria-label={`More for ${item.title}`} aria-expanded={tray} onClick={() => setTray(!tray)} className="row-more btn btn-ghost btn-icon relative">
            <Icon name="more" className="mx-auto size-5" />
          </button>
        )}
      </div>
      {tray && (
        <div className="relative mt-2 grid grid-cols-2 gap-2 pl-2">
          {actions.map(({ label, primary, disabled, run }) => (
            <button key={label} type="button" disabled={disabled} onClick={run} className={`btn ${primary ? 'btn-primary' : 'btn-quiet'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
};
