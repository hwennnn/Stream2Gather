import type { CSSProperties, ReactNode } from 'react';
import type { Media } from '../api/http';
import type { PlayerError } from '../players/types';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { Icon } from './Icon';
import { AddBox, SearchResults, useSearch } from './Omnibox';
import { plural } from './format';
import { listNames, firstName, hueOf } from './people';
import { ReactionBar } from './Reactions';
import { DrivingChip } from './RoomHeader';
import { RoomStatus } from './RoomStatus';
import { canControl, canQueue, failureNote, isLocked, isOffline } from './rules';
import { Seats } from './Seats';
import { SeatTrack } from './SeatTrack';
import { SkipButton } from './SkipButton';
import { failureReason, openLabel } from './sources';
import type { Row } from './seatRow';
import { Thumb } from './Thumb';
import { toastError } from './Toasts';
import { UpNext } from './UpNext';
import { useAdder, type Adder } from './useAdder';
import type { Beat } from './useBeat';
import { NO_FRONT_ROW, useMediaQuery } from './useMediaQuery';
import type { RoomPlayer } from './useRoomPlayer';
import type { Act } from './status';
import { useTrending } from './useTrending';
import { Whisper } from './Whisper';

type StageProps = {
  session: RoomSession;
  view: RoomView;
  player: RoomPlayer;
  theatre: boolean;
  fullscreen: boolean;
  canFullscreen: boolean;
  onTheatre: () => void;
  onFullscreen: () => void;
  onPickAnother: () => void;
  onPeople: () => void;
  onInvite: () => void;
  onShowQueue: () => void;
  row: Row;
  act: Act | null;
  /** Whoever has their hand on the player right now. */
  actor: string | null;
  beat: Beat | null;
  /** The invite link has gone out, and nobody has come in on it yet. */
  saved: boolean;
  /** Everything this tab has seen the room play. */
  watched: QueueItem[];
  /** How long the connection has been gone, or null while it's fine. */
  offlineFor: number | null;
  onRetryConnection: () => void;
  onToast: (text: string) => void;
  /** A labelled group of videos beside search and suggestions. */
  extra?: ReactNode;
  /** Theatre mode has hidden the rail, so what lives there has to show here. */
  railHidden: boolean;
  /** Toasts in theatre mode, when there's no rail to hold them. */
  toastSlot: ReactNode;
};

export const PlayerStage = (props: StageProps) => {
  const { session, view, player, row, actor, beat, saved, watched, railHidden, onInvite, onPeople, onPickAnother, onShowQueue, onToast } = props;
  const current = view.queue[0];
  const noFrontRow = useMediaQuery(NO_FRONT_ROW);

  return (
    <main className="room-main">
      <div className="stage-well">
        <div className={current ? 'stage aspect-video' : 'stage stage-idle'}>
          <div ref={player.stage} data-player className={current ? 'absolute inset-0' : 'hidden'} />
          {!current && <IdleStage session={session} view={view} watched={watched} extra={props.extra} />}
          {current && player.failure && <FailurePanel item={current} error={player.failure} view={view} onPickAnother={onPickAnother} onRetry={player.retry} />}
          {current && !player.failure && !player.ready && <Poster item={current} />}
        </div>
      </div>

      <div className="front-row" data-idle={!current || undefined}>
        <Seats view={view} row={row} actor={actor} beat={beat} saved={saved} onInvite={onInvite} onPeople={onPeople} />
        {current && !railHidden && <ReactionBar session={session} disabled={isOffline(view)} className="hidden xl:flex land:hidden" />}
        {current && !noFrontRow && <SeatTrack view={view} />}
      </div>

      {current && <PlayerBar {...props} item={current} />}
      {!current && <div className="up-next" />}
      {current && <UpNext session={session} view={view} onPickAnother={onPickAnother} onShowQueue={onShowQueue} onToast={onToast} />}
    </main>
  );
};

/** Stands in until the player has a picture, and is gone as soon as a video plays. Never words: the status line has those. */
const Poster = ({ item }: { item: QueueItem }) => (
  <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-stage">
    {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />}
  </div>
);

type FailureProps = { item: QueueItem; error: PlayerError; view: RoomView; onPickAnother: () => void; onRetry: () => void };

export const FailurePanel = ({ item, error, view, onPickAnother, onRetry }: FailureProps) => {
  const reason = failureReason(item.source, error.kind);
  // A refusal of this page's address moves nobody along, so nothing is skipping.
  const note = error.kind === 'ip_origin' ? '' : failureNote(view);
  const watching = view.members.filter(({ userId }) => userId !== view.self?.userId && view.viewerStates[userId] !== 'unavailable');
  const justYou = watching.length > 0;
  // Nobody is watching a paused room, so all that can be said is that it works for them.
  const others = view.playback.status === 'paused' ? 'can play it' : `${watching.length > 1 ? 'are' : 'is'} still watching`;
  return (
    <div className="absolute inset-0 overflow-hidden bg-stage">
      {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover opacity-25" />}
      <div className="absolute inset-0 flex items-center overflow-y-auto px-6 py-4">
        <div className="enter mx-auto w-full max-w-md">
          <h2 className="text-xl leading-7 font-semibold tracking-[-0.01em] phone:text-[17px] phone:leading-6">{justYou ? 'It’s just you.' : 'This video won’t play here.'}</h2>
          <p className="mt-1 text-text phone:text-[13px] phone:leading-[18px]">
            {justYou ? `${listNames(watching.map(({ name }) => firstName(name)))} ${others}. ${reason}` : `${reason} ${note}`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 phone:mt-3">
            {!justYou && canQueue(view) && (
              <button type="button" onClick={onPickAnother} className="btn btn-primary">
                Pick another
              </button>
            )}
            <button type="button" onClick={onRetry} className={justYou ? 'btn btn-primary' : 'btn btn-quiet bg-ink'}>
              Try again
            </button>
            {item.source !== 'direct' && (
              <a href={item.url} target="_blank" rel="noreferrer noopener" className="btn btn-quiet bg-ink">
                {openLabel(item.url)}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const PICKS = 4;

const CREDITS = 5;

/** The screen's off and the lights are up, so it says what the room just watched and whose idea it was. */
const Credits = ({ items }: { items: QueueItem[] }) => {
  const rolled = items.slice(-CREDITS);
  const earlier = items.length - rolled.length;
  return (
    <div className="credits">
      <ol aria-label="What the room watched" style={{ '--lines': rolled.length } as CSSProperties} className="credits-roll">
        {earlier > 0 && <li className="credit-earlier">and {plural(earlier, 'earlier video')}</li>}
        {rolled.map((item) => (
          <li key={item.id} className="credit">
            <span className="line-clamp-2 text-right wrap-anywhere">{item.title}</span>
            <span style={{ color: hueOf(item.addedBy) }} className="truncate font-medium">
              {firstName(item.addedByName)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

const IdleStage = ({ session, view, watched, extra }: { session: RoomSession; view: RoomView; watched: QueueItem[]; extra?: ReactNode }) => {
  const finished = view.ranOut;
  const adder = useAdder(session, view);
  const search = useSearch(adder);
  const trending = useTrending();
  const editable = canQueue(view);
  const searching = search.query !== null;
  const rolling = finished && !searching && watched.length > 0;

  return (
    <div data-searching={searching || undefined} className="stage-dock flex h-full w-full flex-col px-4 py-6 land:py-3">
      {rolling && <Credits items={watched} />}
      <h2 className={`text-xl leading-7 font-semibold tracking-[-0.015em] land:text-[15px] land:leading-5 ${rolling ? 'credits-end' : ''}`}>{finished ? 'The queue’s finished.' : 'What are we watching?'}</h2>
      {!finished && <p className="mt-1 text-dim land:hidden">The lights are down until someone picks something.</p>}
      {!editable && <p className="mt-1 text-muted">The host picks what’s next.</p>}

      {editable && (
        <div className="mt-4 flex min-h-0 w-full flex-col land:mt-2">
          <div className="stage-add">
            <AddBox id="omnibox-stage" search={search} adder={adder} large />
          </div>
          {searching ? (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              <SearchResults search={search} adder={adder} extra={extra} />
            </div>
          ) : (
            <>
              <Picks items={trending} adder={adder} />
              {extra && <div className="min-h-0 overflow-y-auto">{extra}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const Picks = ({ items, adder }: { items: Media[] | null; adder: Adder }) => {
  if (items?.length === 0) return null;
  return (
    <ul aria-label="Popular on YouTube" className="stage-picks mt-4 grid grid-cols-4 gap-2 phone:grid-cols-2 land:mt-2">
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
                <Thumb src={media.thumbnailUrl} className="w-full rounded-md" />
                <span className="mt-1.5 line-clamp-2 text-xs leading-4 text-muted transition-colors group-hover:text-text land:hidden">
                  {media.title}
                </span>
              </button>
            </li>
          ))
        : Array.from({ length: PICKS }, (_, index) => <li key={index} className="skeleton aspect-video rounded-md" />)}
    </ul>
  );
};

/** On a phone it's just the icon, at the player's corner, so the status keeps its line and chat keeps its height. */
export const UnmuteButton = ({ player, className = '' }: { player: RoomPlayer; className?: string }) => {
  if (!player.muted || player.failure || player.refused) return null;
  return (
    <button type="button" onClick={player.unmute} className={`btn btn-primary phone:ml-2 phone:size-11 phone:px-0 ${className}`}>
      <Icon name="muted" />
      <span className="phone:sr-only">Tap to unmute</span>
    </button>
  );
};

const ResumeButton = ({ session, view, onToast }: { session: RoomSession; view: RoomView; onToast: (text: string) => void }) => {
  const { item, pos } = view.playback;
  const resume = () => void session.request('play', { item, pos, ct: session.clock.now() }).catch(toastError(onToast));
  return (
    <button type="button" disabled={isOffline(view)} onClick={resume} className="btn btn-primary phone:flex-1">
      Resume for everyone
    </button>
  );
};

/** The one primary in the bar. A paused room needs starting; sound can wait until it has. */
export const MainAction = ({ session, view, player, onToast }: { session: RoomSession; view: RoomView; player: RoomPlayer; onToast: (text: string) => void }) => {
  if (view.playback.status !== 'paused') return <UnmuteButton player={player} />;
  return !player.failure && canControl(view) ? <ResumeButton session={session} view={view} onToast={onToast} /> : null;
};

type BarProps = StageProps & { item: QueueItem };

export const PlayerBar = ({ session, view, player, item, theatre, fullscreen, canFullscreen, offlineFor, onRetryConnection, act, onTheatre, onFullscreen, onToast, railHidden, toastSlot }: BarProps) => {
  const failed = player.failure !== null;
  // Resume keeps its whole label on a phone, and that mustn't cost the line saying why it's there.
  const stacked = view.playback.status === 'paused' && !failed && canControl(view);
  return (
    <section aria-label="Player controls" className="player-bar relative">
      <div className={`flex items-center gap-4 px-4 phone:gap-0 ${stacked ? 'min-h-[var(--info)] phone:flex-wrap phone:gap-y-2 phone:py-2' : 'h-[var(--info)]'}`}>
        <div className={`min-w-0 flex-1 ${stacked ? 'phone:basis-full' : ''}`}>
          <div className="flex items-center gap-2">
            <h2 title={item.title} className="min-w-0 flex-1 truncate text-lg leading-6 font-semibold tracking-[-0.01em] phone:text-[15px] phone:leading-5">
              {item.title}
            </h2>
            {isLocked(view) && <DrivingChip view={view} className="hidden shrink-0 phone:inline-flex" />}
          </div>
          <RoomStatus view={view} player={player} act={act} offlineFor={offlineFor} onRetry={onRetryConnection} />
        </div>

        {railHidden && <Whisper messages={view.messages} selfId={view.self?.userId} />}
        {railHidden && <ReactionBar session={session} disabled={isOffline(view)} className="flex" />}

        {/* A phone's line belongs to the title and the status, so Skip waits in Queue, a deliberate step from sound. */}
        <div className={`flex shrink-0 items-center gap-2 ${stacked ? 'phone:w-full' : ''}`}>
          <MainAction session={session} view={view} player={player} onToast={onToast} />
          {canControl(view) && <SkipButton session={session} view={view} onToast={onToast} className="phone:hidden" />}
          {!failed && (
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
          )}
        </div>
      </div>

      {toastSlot}
    </section>
  );
};

