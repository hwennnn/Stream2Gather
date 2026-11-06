import { useState, type ReactNode } from 'react';
import type { Media } from '../api/http';
import type { PlayerError } from '../players/types';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { formatTime } from './format';
import { Icon } from './Icon';
import { AddBox, SearchResults, useSearch } from './Omnibox';
import { ReactionBar, ReactionTicker } from './Reactions';
import { HostChip } from './RoomHeader';
import { canControl, canQueue, failureNote, isLocked, isOffline, pillFor } from './rules';
import { Thumb } from './Thumb';
import { toastError } from './Toasts';
import { UpNext } from './UpNext';
import { useAdder, type Adder } from './useAdder';
import type { RoomPlayer } from './useRoomPlayer';
import { useTrending } from './useTrending';

type StageProps = {
  session: RoomSession;
  view: RoomView;
  player: RoomPlayer;
  /** A video has finished in this visit, so an empty room means the queue ran out. */
  finished: boolean;
  /** Set while the video after this one is loading. */
  changing: boolean;
  theatre: boolean;
  fullscreen: boolean;
  canFullscreen: boolean;
  onTheatre: () => void;
  onFullscreen: () => void;
  onPickAnother: () => void;
  onShowQueue: () => void;
  onToast: (text: string) => void;
  /** Theatre mode has hidden the rail, so what lives there has to show here. */
  railHidden: boolean;
  /** Toasts in theatre mode, when there's no rail to hold them. */
  toastSlot: ReactNode;
};

export const PlayerStage = (props: StageProps) => {
  const { session, view, player, finished, changing, onPickAnother, onShowQueue, onToast } = props;
  const current = view.queue[0];

  return (
    <main className="room-main">
      <div className={current ? 'stage aspect-video' : 'stage stage-idle'}>
        <div ref={player.stage} data-player className={current ? 'absolute inset-0' : 'hidden'} />
        {!current && <IdleStage session={session} view={view} finished={finished} />}
        {current && player.failure && <FailurePanel item={current} error={player.failure} view={view} onPickAnother={onPickAnother} />}
        {current && !player.failure && !player.ready && <Poster item={current} changing={changing} />}
      </div>

      {current && <PlayerBar {...props} item={current} />}
      {current && <UpNext session={session} view={view} onPickAnother={onPickAnother} onShowQueue={onShowQueue} onToast={onToast} />}
    </main>
  );
};

/** Stands in until the player is ready, and is gone before anything can play. */
const Poster = ({ item, changing }: { item: QueueItem; changing: boolean }) => (
  <div className="absolute inset-0 overflow-hidden bg-panel">
    {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="absolute inset-0 size-full scale-105 object-cover opacity-40 blur-[2px]" />}
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 px-6 text-center" role="status">
      {changing && (
        <p className="enter mb-3 max-w-xl text-lg leading-snug font-semibold text-balance phone:text-[15px]">
          Up next: {item.title}, added by {item.addedByName}.
        </p>
      )}
      <p className="flex items-center gap-2 text-sm text-text/80">
        <span className="spinner" />
        Loading…
      </p>
    </div>
  </div>
);

const REASONS = new Map<PlayerError['kind'], string>([
  ['embed_blocked', 'Its owner only allows it on YouTube.'],
  ['network', 'The player couldn’t load. Check your connection, or anything blocking YouTube.'],
]);

const FailurePanel = ({ item, error, view, onPickAnother }: { item: QueueItem; error: PlayerError; view: RoomView; onPickAnother: () => void }) => {
  const reason = REASONS.get(error.kind) ?? 'It may have been removed, or it isn’t available where you are.';
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-panel px-6 py-4 text-center">
      <div className="enter">
        <h2 className="text-xl font-semibold tracking-tight phone:text-lg">This video won’t play here</h2>
        <p className="mt-1.5 max-w-md text-sm text-muted">
          {reason} {failureNote(view)}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {canQueue(view) && (
            <button type="button" onClick={onPickAnother} className="btn btn-primary">
              Pick another
            </button>
          )}
          {item.source === 'youtube' && (
            <a href={item.url} target="_blank" rel="noreferrer noopener" className="btn btn-quiet">
              Open on YouTube
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

const PICKS = 4;

const IdleStage = ({ session, view, finished }: { session: RoomSession; view: RoomView; finished: boolean }) => {
  const adder = useAdder(session, view);
  const search = useSearch(adder);
  const trending = useTrending();
  const editable = canQueue(view);
  const searching = search.query !== null;

  return (
    <div className="glow flex h-full flex-col items-center justify-center px-5 py-6 text-center land:py-3">
      <h2 className="text-3xl font-semibold tracking-tight text-balance phone:text-2xl land:text-xl">
        {finished ? 'That’s the queue' : 'What are we watching?'}
      </h2>
      <p className="mt-1.5 text-muted land:hidden">
        {!editable ? 'The host picks what’s next.' : finished ? 'Pick the next one' : 'Paste a link or search YouTube.'}
      </p>

      {editable && (
        <div className="mt-5 flex min-h-0 w-full max-w-xl flex-col land:mt-2">
          <AddBox id="omnibox-stage" search={search} adder={adder} large />
          {searching ? (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl bg-black/30 py-2 text-left">
              <SearchResults search={search} adder={adder} />
            </div>
          ) : (
            <Picks items={trending} adder={adder} />
          )}
        </div>
      )}
    </div>
  );
};

const Picks = ({ items, adder }: { items: Media[] | null; adder: Adder }) => {
  if (items?.length === 0) return null;
  return (
    <ul aria-label="Trending" className="mt-4 grid grid-cols-4 gap-2 phone:grid-cols-2 land:mt-2">
      {items
        ? items.slice(0, PICKS).map((media) => (
            <li key={media.sourceId} className="min-w-0">
              <button
                type="button"
                aria-label={`Play ${media.title}`}
                disabled={adder.statusOf(media) === 'adding'}
                onClick={() => void adder.addMedia(media, 'end')}
                className="group block w-full cursor-pointer text-left disabled:opacity-60"
              >
                <Thumb src={media.thumbnailUrl} className="w-full rounded-lg ring-1 ring-line transition group-hover:brightness-110" />
                <span className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted transition-colors group-hover:text-text land:hidden">
                  {media.title}
                </span>
              </button>
            </li>
          ))
        : Array.from({ length: PICKS }, (_, index) => <li key={index} className="skeleton aspect-video rounded-lg" />)}
    </ul>
  );
};

const DOTS = new Map([
  ['good', 'bg-good'],
  ['warn', 'bg-warn'],
  ['bad', 'bg-accent'],
]);

export const SyncPill = ({ view, player }: { view: RoomView; player: RoomPlayer }) => {
  const pill = pillFor(view, player.report.health);
  const live = pill.tone === 'good' || pill.text === 'Catching up';
  const paused = pill.tone === 'paused';
  return (
    <span
      title={live ? `${Math.round(Math.abs(player.report.drift) * 1000)} ms from the room` : paused ? pill.text : undefined}
      className={`chip max-w-56 min-w-0 shrink ${paused ? 'chip-paused' : ''}`}
    >
      {paused ? <Icon name="pause" className="size-3 shrink-0" /> : <span className={`size-1.5 shrink-0 rounded-full ${DOTS.get(pill.tone)}`} />}
      <span className="truncate">{pill.text}</span>
    </span>
  );
};

export const SkipButton = ({ session, view, onToast, className = '' }: { session: RoomSession; view: RoomView; onToast: (text: string) => void; className?: string }) => {
  const [busy, setBusy] = useState(false);
  const skip = async () => {
    setBusy(true);
    try {
      await session.request('skip', { item: view.playback.item });
    } catch (error) {
      toastError(onToast)(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={busy || isOffline(view)} onClick={() => void skip()} className={`btn btn-quiet ${className}`}>
      {view.queue.length > 1 ? 'Skip' : 'End video'}
    </button>
  );
};

export const UnmuteButton = ({ player, className = '' }: { player: RoomPlayer; className?: string }) => {
  if (!player.muted || player.failure) return null;
  return (
    <button type="button" onClick={player.unmute} className={`btn btn-primary ${className}`}>
      <Icon name="muted" />
      Tap to unmute
    </button>
  );
};

/** Says where the room stopped, here because nothing may be drawn over the player. */
const ColdPause = ({ session, view, onToast }: { session: RoomSession; view: RoomView; onToast: (text: string) => void }) => {
  const { item, pos } = view.playback;
  const resume = () => void session.request('play', { item, pos, ct: session.clock.now() }).catch(toastError(onToast));
  return (
    <>
      <span className="chip shrink-0">
        <span className="size-1.5 shrink-0 rounded-full bg-muted" />
        Paused at {formatTime(pos)}
      </span>
      {canControl(view) && (
        <button type="button" disabled={isOffline(view)} onClick={resume} className="btn btn-primary">
          Resume for everyone
        </button>
      )}
    </>
  );
};

const PlayerBar = ({ session, view, player, item, theatre, fullscreen, canFullscreen, onTheatre, onFullscreen, onToast, railHidden, toastSlot }: StageProps & { item: QueueItem }) => (
  <section aria-label="Player controls" className="player-bar relative flex items-center gap-4 px-4 phone:flex-col phone:items-stretch phone:gap-1 phone:py-2 sm:max-lg:py-2.5">
    <div className="min-w-28 flex-1">
      <h2 title={item.title} className="truncate text-[15px] leading-tight font-semibold">
        {item.title}
      </h2>
      {item.author && <p className="mt-0.5 truncate text-[13px] text-muted phone:hidden">{item.author}</p>}
    </div>

    {railHidden && <ReactionTicker reactions={view.reactions} />}

    <div className="flex min-w-0 items-center gap-2">
      {!player.failure && !player.cold && <SyncPill view={view} player={player} />}
      {isLocked(view) && <HostChip className="hidden phone:inline-flex" />}
      <UnmuteButton player={player} />
      {player.cold && !player.failure && <ColdPause session={session} view={view} onToast={onToast} />}
      <span className="flex-1" />
      {canControl(view) && <SkipButton session={session} view={view} onToast={onToast} />}
      <ReactionBar session={session} disabled={isOffline(view)} className={railHidden ? 'flex' : 'hidden xl:flex'} />
      <div className="hidden items-center lg:flex">
        {!fullscreen && (
          <button type="button" aria-label="Theatre" title="Theatre (T)" aria-pressed={theatre} onClick={onTheatre} className="btn btn-ghost btn-icon">
            <Icon name="theatre" className="size-[18px]" />
          </button>
        )}
        {canFullscreen && (
          <button
            type="button"
            aria-label="Fullscreen with chat"
            title={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen with chat (F)'}
            aria-pressed={fullscreen}
            onClick={onFullscreen}
            className="btn btn-ghost btn-icon"
          >
            <Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} className="size-[18px]" />
          </button>
        )}
      </div>
    </div>

    {toastSlot}
  </section>
);
