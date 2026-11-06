import { lazy, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { api, ApiError, type RoomPreview } from '../api/http';
import { account, useAccount } from '../auth/account';
import { useInviteUrl } from '../crew/useInviteUrl';
import { RoomSession, type RoomView } from '../room/session';
import { track } from '../room/telemetry';
import { ChatPanel, useUnread } from '../ui/ChatPanel';
import { closedRoom, DeadEnd, ENDINGS, fullRoom, type Ending } from '../ui/DeadEnd';
import { JoinGate } from '../ui/JoinGate';
import { InviteSheet } from '../ui/InviteSheet';
import { peopleLastIn, rememberRoom } from './landing/recent';
import { Page } from '../ui/Page';
import { firstName } from '../ui/people';
import { RoomStatus, useLatestAct } from '../ui/RoomStatus';
import { useSeats } from '../ui/Seats';
import { PeoplePanel } from '../ui/PeoplePanel';
import { PlayerStage, SkipButton, UnmuteButton } from '../ui/PlayerStage';
import { ReactionLane } from '../ui/Reactions';
import { QueuePanel } from '../ui/QueuePanel';
import { RoomHeader } from '../ui/RoomHeader';
import { canControl, chatOffersInvite, noticesToShow, onCrew, toastLift } from '../ui/rules';
import { Slot } from '../ui/Slot';
import { JumpToast, ToastStack, useToasts } from '../ui/Toasts';
import { canFullscreen, useFullscreen } from '../ui/useFullscreen';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useOfflineNotice } from '../ui/useOfflineNotice';
import { usePageVisible } from '../ui/usePageVisible';
import { useRoomPlayer } from '../ui/useRoomPlayer';
import { useShownView } from '../ui/useShownView';

const CrewHome = lazy(() => import('./CrewHome'));
const VoiceButton = lazy(() => import('../voice/VoiceButton'));
const RoomWatchlist = lazy(() => import('../crew/RoomWatchlist'));

// Both stay mounted behind their tabs, so they have to be able to sit still there.
const QueueTab = memo(QueuePanel);
const PeopleTab = memo(PeoplePanel);

type Tab = 'chat' | 'queue' | 'people';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'queue', label: 'Queue' },
  { id: 'people', label: 'People' },
];

const CONNECT_PATIENCE_MS = 15_000;

const COPIED_MS = 2000;

const arrival = () => (window.history.state ?? {}) as { joined?: boolean };

const endingFor = (error: unknown, slug: string): Ending => {
  if (error instanceof ApiError) {
    if (error.status === 404) return ENDINGS.missing;
    if (error.status === 410) return closedRoom(peopleLastIn(slug));
  }
  return ENDINGS.unreachable;
};

const isFull = (preview: RoomPreview, userId: string | undefined): boolean =>
  preview.members.length >= preview.maxMembers && !preview.members.some((person) => person.userId === userId);

export const RoomPage = ({ slug }: { slug: string }) => {
  const [joined, setJoined] = useState(() => arrival().joined === true);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { user } = useAccount();

  useEffect(() => {
    if (joined) return undefined;
    let live = true;
    setEnding(null);
    api.preview(slug).then(
      (next) => live && setPreview(next),
      (error: unknown) => live && setEnding(endingFor(error, slug)),
    );
    return () => {
      live = false;
    };
  }, [attempt, joined, slug]);

  const join = async (name: string, changed: boolean) => {
    // A failed rename only costs the name, so it shouldn't stop anyone joining.
    if (changed) await account.rename(name).catch(() => {});
    // A reload then goes straight back in. Without the gate's click the video starts
    // muted, and Tap to unmute is there for that.
    window.history.replaceState({ ...arrival(), joined: true }, '');
    setJoined(true);
  };

  if (!joined) {
    if (ending) return <DeadEnd {...ending} onRetry={ending === ENDINGS.unreachable ? () => setAttempt(attempt + 1) : undefined} />;
    if (preview && isFull(preview, user?.id)) return <DeadEnd {...fullRoom(preview.members)} />;
    const gate = <JoinGate preview={preview} onJoin={join} />;
    if (!preview?.crew) return gate;
    return (
      <Slot fallback={gate}>
        <CrewHome slug={slug} preview={preview} onJoin={join} />
      </Slot>
    );
  }
  return <Room slug={slug} />;
};

const Room = ({ slug }: { slug: string }) => {
  const session = useMemo(() => new RoomSession(slug), [slug]);
  const view = useSyncExternalStore(session.subscribe, session.getView);

  useEffect(() => {
    void session.connect();
    const stopFollowing = session.followPage();
    return () => {
      stopFollowing();
      session.close();
    };
  }, [session]);

  useEffect(() => account.onIdentityChange(() => session.identityChanged(account.current().user?.id)), [session]);
  useEffect(() => session.onSignedOut(() => void account.refresh()), [session]);

  useEffect(() => {
    if (view.connection === 'live' && session.marks.joinMs !== undefined) {
      track({ name: 'join_ms', value: session.marks.joinMs, room: slug });
    }
  }, [session, slug, view.connection]);

  if (view.connection === 'failed') return <RoomFailure slug={slug} failure={view.failure} />;
  if (!view.self) return <Waiting session={session} view={view} />;
  return <RoomShell slug={slug} session={session} view={view} />;
};

/** The ticket only says no. The preview can say why. */
const RoomFailure = ({ slug, failure }: { slug: string; failure: string | null }) => {
  const [ending, setEnding] = useState<Ending | null>(null);

  useEffect(() => {
    let live = true;
    api.preview(slug).then(
      (preview) => {
        if (!live) return;
        const full = preview.members.length >= preview.maxMembers;
        setEnding(full ? fullRoom(preview.members) : { title: 'We couldn’t open this room', body: failure ?? 'Try the link again in a moment.' });
      },
      (error: unknown) => live && setEnding(endingFor(error, slug)),
    );
    return () => {
      live = false;
    };
  }, [failure, slug]);

  return ending ? <DeadEnd {...ending} /> : <main className="h-full bg-ink" />;
};

const Waiting = ({ session, view }: { session: RoomSession; view: RoomView }) => {
  const [patient, setPatient] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPatient(true);
    const timer = window.setTimeout(() => setPatient(false), CONNECT_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [attempt]);

  if (!patient) {
    return (
      <DeadEnd
        {...ENDINGS.unreachable}
        onRetry={() => {
          session.retry();
          setAttempt(attempt + 1);
        }}
      />
    );
  }
  return (
    <Page status>
      <p className="flex items-center gap-2.5 text-muted">
        <span className="spinner" />
        {view.connection === 'reconnecting' ? 'Still connecting…' : 'Joining the room…'}
      </p>
    </Page>
  );
};

type ShellProps = { slug: string; session: RoomSession; view: RoomView };

const RoomShell = ({ slug, session, view }: ShellProps) => {
  const [tab, setTab] = useState<Tab>('chat');
  const [theatre, setTheatre] = useState(false);
  const [changing, setChanging] = useState(false);
  const [inviting, setInviting] = useState(false);
  const row = useSeats(view);
  const act = useLatestAct(view);
  const actor = view.playback.status === 'paused' ? (view.playback.pausedBy ?? null) : (act?.by ?? null);
  const { toasts, toast } = useToasts();
  const fullscreen = useFullscreen();
  const player = useRoomPlayer(session, view);
  const wide = useMediaQuery('(min-width: 1024px)');
  const visible = usePageVisible();

  const current = view.queue[0];
  const railHidden = theatre && wide && !fullscreen.on && current !== undefined;
  const inviteUrl = useInviteUrl(session, view);

  const queueView = useShownView(view, tab === 'queue' && !railHidden);
  const peopleView = useShownView(view, tab === 'people' && !railHidden);
  const watchlist = useMemo(
    () =>
      onCrew(queueView) ? (
        <Slot>
          <RoomWatchlist session={session} view={queueView} />
        </Slot>
      ) : undefined,
    [session, queueView],
  );

  const unread = useUnread(view.messages, view.self?.userId, tab === 'chat' && !railHidden && visible);

  const back = useCallback(() => toast('You’re back'), [toast]);
  const offlineFor = useOfflineNotice(view, back);

  // Remembers whether this visit has seen a video, and whether one just replaced another.
  const seenItem = useRef<string | null>(null);
  useEffect(() => {
    const id = current?.id ?? null;
    if (seenItem.current && id !== seenItem.current) {
      setChanging(id !== null);
    }
    if (id) seenItem.current = id;
  }, [current?.id]);

  const others = useMemo(() => view.members.filter(({ userId }) => userId !== view.self?.userId), [view.members, view.self?.userId]);
  useEffect(() => rememberRoom(slug, view.name, others), [slug, view.name, others]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${view.name}` : view.name;
    return () => {
      document.title = 'Stream2Gather';
    };
  }, [unread, view.name]);

  /** The stage owns finding a video until something is playing, and the rail after that. */
  const idle = current === undefined;
  const openQueue = useCallback(() => {
    if (!idle) setTab('queue');
    setTheatre(false);
    window.requestAnimationFrame(() => document.getElementById(idle ? 'omnibox-stage' : 'omnibox')?.focus());
  }, [idle]);

  const toggleFullscreen = fullscreen.toggle;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openQueue();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || !wide || !current) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) return;
      const key = event.key.toLowerCase();
      if (key === 't' && !fullscreen.on) setTheatre((on) => !on);
      if (key === 'f' && canFullscreen()) toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, fullscreen.on, openQueue, toggleFullscreen, wide]);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // The sheet shows the link, ready to select by hand.
    }
  };

  const invite = async () => {
    setInviting(true);
    setTheatre(false);
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: `${firstName(view.self?.name ?? '')} saved you a seat`, text: view.name, url: inviteUrl }).catch(() => {});
      return;
    }
    await copyInvite();
  };

  const openPeople = () => {
    setTab('people');
    setTheatre(false);
  };

  const retryConnection = () => session.retry();
  const roomStatus = (className: string) => <RoomStatus view={view} player={player} act={act} offlineFor={offlineFor} onRetry={retryConnection} compact className={className} />;

  const moveTab = (event: KeyboardEvent) => {
    const index = TABS.findIndex(({ id }) => id === tab);
    const steps = new Map([
      ['ArrowRight', index + 1],
      ['ArrowLeft', index - 1 + TABS.length],
      ['Home', 0],
      ['End', TABS.length - 1],
    ]);
    const next = steps.get(event.key);
    if (next === undefined) return;
    event.preventDefault();
    const target = TABS[next % TABS.length];
    if (!target) return;
    setTab(target.id);
    document.getElementById(`tab-${target.id}`)?.focus();
  };

  const toastStack = (where: string, limit?: number) => (
    <ToastStack toasts={toasts} notices={noticesToShow(view.notices, tab, railHidden)} limit={limit} className={where}>
      <JumpToast session={session} view={view} onToast={toast} />
    </ToastStack>
  );

  return (
    <div data-fullscreen={fullscreen.on} className="room-shell flex h-dvh flex-col bg-ink">
      {!fullscreen.on && (
        <RoomHeader
          session={session}
          view={view}
          adapter={player.adapter}
          row={row}
          actor={actor}
          note={!current && offlineFor !== null ? roomStatus('') : null}
          onAccountOpen={() => setTheatre(false)}
          onInvite={() => void invite()}
          onPeople={openPeople}
          landscapeControls={
            current && (
              <>
                {roomStatus('max-w-40')}
                <UnmuteButton player={player} />
                {canControl(view) && <SkipButton session={session} view={view} onToast={toast} />}
              </>
            )
          }
        />
      )}

      <div className="room-body">
        <PlayerStage
          extra={watchlist}
          session={session}
          view={view}
          player={player}
          changing={changing}
          theatre={theatre}
          fullscreen={fullscreen.on}
          canFullscreen={canFullscreen()}
          onTheatre={() => setTheatre(!theatre)}
          onFullscreen={fullscreen.toggle}
          onPickAnother={openQueue}
          onPeople={openPeople}
          onInvite={() => void invite()}
          onShowQueue={() => setTab('queue')}
          row={row}
          act={act}
          actor={actor}
          queueOpen={tab === 'queue'}
          offlineFor={offlineFor}
          onRetryConnection={retryConnection}
          onToast={toast}
          railHidden={railHidden}
          toastSlot={railHidden && toastStack('absolute inset-0 justify-center bg-ink px-4 empty:hidden', 1)}
        />

        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-line px-3 py-1.5 empty:hidden">
          <Slot>
            <VoiceButton session={session} view={view} adapter={player.adapter} place="bar" />
          </Slot>
        </div>

        {/* Hidden rather than removed, so a chat draft survives theatre mode. */}
        <aside aria-label="Room" hidden={railHidden} className="room-rail">
          {inviting && !chatOffersInvite(view, tab) && <InviteSheet view={view} url={inviteUrl} copied={copied} onCopy={() => void copyInvite()} onClose={() => setInviting(false)} />}
          <div role="tablist" aria-label="Room panels" onKeyDown={moveTab} className="rail-edge flex shrink-0 gap-5 border-b border-line">
            {TABS.map(({ id, label }) => {
              const count = id === 'queue' ? Math.max(view.queue.length - 1, 0) : id === 'people' ? view.members.length : 0;
              return (
                <button
                  key={id}
                  id={`tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  className="tab"
                >
                  {label}
                  {count > 0 && <span className="fig font-normal text-dim">{count}</span>}
                  {id === 'chat' && unread > 0 && (
                    <span className="fig font-medium text-text">
                      <span className="sr-only">, unread: </span>
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" hidden={tab !== 'chat'} className="min-h-0 flex-1">
            <ChatPanel
              session={session}
              view={view}
              active={tab === 'chat'}
              inviteUrl={inviteUrl}
              inviteCopied={copied}
              onCopyInvite={() => void copyInvite()}
              onInvite={() => void invite()}
              onToast={toast}
            />
          </div>
          <div id="panel-queue" role="tabpanel" aria-labelledby="tab-queue" hidden={tab !== 'queue'} className="min-h-0 flex-1">
            <QueueTab session={session} view={queueView} onToast={toast} extra={watchlist} />
          </div>
          <div id="panel-people" role="tabpanel" aria-labelledby="tab-people" hidden={tab !== 'people'} className="min-h-0 flex-1">
            <PeopleTab session={session} view={peopleView} onToast={toast} />
          </div>

          <ReactionLane reactions={view.reactions} />
          {!railHidden && toastStack(`absolute inset-x-[var(--gutter)] ${toastLift(tab)}`)}
        </aside>
      </div>
    </div>
  );
};

