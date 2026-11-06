import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { api, ApiError, type RoomPreview } from '../api/http';
import { account, useAccount } from '../auth/account';
import { RoomSession, type RoomView } from '../room/session';
import { track } from '../room/telemetry';
import { ChatPanel, useUnread } from '../ui/ChatPanel';
import { DeadEnd, ENDINGS, fullRoom, type Ending } from '../ui/DeadEnd';
import { JoinGate } from '../ui/JoinGate';
import { PeoplePanel } from '../ui/PeoplePanel';
import { PlayerStage, SkipButton, SyncPill, UnmuteButton } from '../ui/PlayerStage';
import { ReactionLane } from '../ui/Reactions';
import { QueuePanel } from '../ui/QueuePanel';
import { RoomHeader } from '../ui/RoomHeader';
import { canControl, toastLift } from '../ui/rules';
import { JumpToast, ToastStack, useToasts } from '../ui/Toasts';
import { canFullscreen, useFullscreen } from '../ui/useFullscreen';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useOfflineNotice } from '../ui/useOfflineNotice';
import { usePageVisible } from '../ui/usePageVisible';
import { useRoomPlayer } from '../ui/useRoomPlayer';

type Tab = 'chat' | 'queue' | 'people';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'queue', label: 'Queue' },
  { id: 'people', label: 'People' },
];

const CONNECT_PATIENCE_MS = 15_000;
const STILL_TRYING_MS = 30_000;

const arrival = () => (window.history.state ?? {}) as { joined?: boolean; copied?: boolean };

const endingFor = (error: unknown): Ending => {
  if (error instanceof ApiError) {
    if (error.status === 404) return ENDINGS.missing;
    if (error.status === 410) return ENDINGS.closed;
  }
  return ENDINGS.unreachable;
};

const isFull = (preview: RoomPreview, userId: string | undefined): boolean =>
  preview.members.length >= preview.maxMembers && !preview.members.some((person) => person.userId === userId);

export const RoomPage = ({ slug }: { slug: string }) => {
  const [joined, setJoined] = useState(() => arrival().joined === true);
  const [copied] = useState(() => arrival().copied === true);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { user } = useAccount();

  // Only the arrival was copied. A reload must not claim it again.
  useEffect(() => {
    if (!arrival().copied) return;
    window.history.replaceState({ ...arrival(), copied: false }, '');
  }, []);

  useEffect(() => {
    if (joined) return undefined;
    let live = true;
    setEnding(null);
    api.preview(slug).then(
      (next) => live && setPreview(next),
      (error: unknown) => live && setEnding(endingFor(error)),
    );
    return () => {
      live = false;
    };
  }, [attempt, joined, slug]);

  const join = async (name: string, changed: boolean) => {
    // A failed rename only costs the name, so it shouldn't stop anyone joining.
    if (changed) await account.rename(name).catch(() => {});
    setJoined(true);
  };

  if (!joined) {
    if (ending) return <DeadEnd {...ending} onRetry={ending === ENDINGS.unreachable ? () => setAttempt(attempt + 1) : undefined} />;
    if (preview && isFull(preview, user?.id)) return <DeadEnd {...fullRoom(preview.members.length, preview.maxMembers)} />;
    return <JoinGate preview={preview} onJoin={join} />;
  }
  return <Room slug={slug} copied={copied} />;
};

const Room = ({ slug, copied }: { slug: string; copied: boolean }) => {
  const session = useMemo(() => new RoomSession(slug), [slug]);
  const view = useSyncExternalStore(session.subscribe, session.getView);

  useEffect(() => {
    void session.connect();
    return () => session.close();
  }, [session]);

  useEffect(() => account.onIdentityChange(() => session.retry()), [session]);

  useEffect(() => {
    if (view.connection === 'live' && session.marks.joinMs !== undefined) {
      track({ name: 'join_ms', value: session.marks.joinMs, room: slug });
    }
  }, [session, slug, view.connection]);

  if (view.connection === 'failed') return <RoomFailure slug={slug} failure={view.failure} />;
  if (!view.self) return <Waiting session={session} view={view} />;
  return <RoomShell slug={slug} session={session} view={view} copied={copied} />;
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
        setEnding(full ? fullRoom(preview.members.length, preview.maxMembers) : { title: 'We couldn’t open this room', body: failure ?? 'Try the link again in a moment.' });
      },
      (error: unknown) => live && setEnding(endingFor(error)),
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
    <main className="glow flex h-full items-center justify-center px-6 text-center" role="status">
      <div>
        <span className="spinner mx-auto block size-7 text-accent" />
        <p className="mt-4 text-muted">{view.connection === 'reconnecting' ? 'Still connecting…' : 'Joining the room…'}</p>
      </div>
    </main>
  );
};

const OfflineBar = ({ elapsed, onRetry }: { elapsed: number; onRetry: () => void }) => {
  const long = elapsed >= STILL_TRYING_MS;
  return (
    <div role="status" className="flex min-h-9 shrink-0 items-center justify-center gap-3 bg-warn/12 px-4 py-1 text-[13px] text-warn">
      {long ? 'Still trying. Check your connection.' : 'Connection lost. Reconnecting…'}
      {long && (
        <button type="button" onClick={onRetry} className="btn btn-sm bg-warn font-semibold text-ink">
          Try again
        </button>
      )}
    </div>
  );
};

type ShellProps = { slug: string; session: RoomSession; view: RoomView; copied: boolean };

const RoomShell = ({ slug, session, view, copied }: ShellProps) => {
  const [tab, setTab] = useState<Tab>('chat');
  const [theatre, setTheatre] = useState(false);
  const [finished, setFinished] = useState(false);
  const [changing, setChanging] = useState(false);
  const { toasts, toast } = useToasts();
  const fullscreen = useFullscreen();
  const player = useRoomPlayer(session, view);
  const wide = useMediaQuery('(min-width: 1024px)');
  const visible = usePageVisible();

  const current = view.queue[0];
  const railHidden = theatre && wide && !fullscreen.on && current !== undefined;
  const inviteUrl = `${window.location.origin}/r/${slug}`;

  const unread = useUnread(view.messages, view.self?.userId, tab === 'chat' && !railHidden && visible);

  const back = useCallback(() => toast('You’re back'), [toast]);
  const offlineFor = useOfflineNotice(view, back);

  // Remembers whether this visit has seen a video, and whether one just replaced another.
  const seenItem = useRef<string | null>(null);
  useEffect(() => {
    const id = current?.id ?? null;
    if (seenItem.current && id !== seenItem.current) {
      setChanging(id !== null);
      setFinished(true);
    }
    if (id) seenItem.current = id;
  }, [current?.id]);

  const welcomed = useRef(false);
  useEffect(() => {
    if (copied && !welcomed.current) toast('Link copied. Paste it to a friend.');
    welcomed.current = true;
  }, [copied, toast]);

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

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast('Link copied. Paste it to a friend.');
    } catch {
      toast(`Copy this link: ${inviteUrl}`);
    }
  };

  const invite = async () => {
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: view.name, url: inviteUrl }).catch(() => {});
      return;
    }
    await copyInvite();
  };

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
    <ToastStack toasts={toasts} notices={view.notices} limit={limit} className={where}>
      <JumpToast session={session} view={view} onToast={toast} />
    </ToastStack>
  );

  return (
    <div data-fullscreen={fullscreen.on} className="room-shell flex h-dvh flex-col bg-ink">
      {!fullscreen.on && (
        <RoomHeader
          view={view}
          onAccountOpen={() => setTheatre(false)}
          onInvite={() => void invite()}
          onPeople={() => {
            setTab('people');
            setTheatre(false);
          }}
          landscapeControls={
            current && (
              <>
                {!player.failure && <SyncPill view={view} player={player} />}
                <UnmuteButton player={player} />
                {canControl(view) && <SkipButton session={session} view={view} onToast={toast} />}
              </>
            )
          }
        />
      )}
      {offlineFor !== null && <OfflineBar elapsed={offlineFor} onRetry={() => session.retry()} />}

      <div className="room-body">
        <PlayerStage
          session={session}
          view={view}
          player={player}
          finished={finished}
          changing={changing}
          theatre={theatre}
          fullscreen={fullscreen.on}
          canFullscreen={canFullscreen()}
          onTheatre={() => setTheatre(!theatre)}
          onFullscreen={fullscreen.toggle}
          onPickAnother={openQueue}
          onShowQueue={() => setTab('queue')}
          onToast={toast}
          railHidden={railHidden}
          toastSlot={railHidden && toastStack('absolute inset-0 justify-center bg-ink/90 px-4 empty:hidden', 1)}
        />

        {/* Hidden rather than removed, so a chat draft survives theatre mode. */}
        <aside aria-label="Room" hidden={railHidden} className="room-rail">
          <div role="tablist" aria-label="Room panels" onKeyDown={moveTab} className="flex shrink-0 gap-1 border-b border-line p-1.5">
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
                  className={`btn flex-1 ${tab === id ? 'bg-white/[0.09] text-text' : 'text-muted hover:text-text'}`}
                >
                  {label}
                  {count > 0 && <span className="font-normal text-muted">{count}</span>}
                  {id === 'chat' && unread > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-ink">
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
              onCopyInvite={() => void copyInvite()}
              onInvite={() => void invite()}
              onToast={toast}
            />
          </div>
          <div id="panel-queue" role="tabpanel" aria-labelledby="tab-queue" hidden={tab !== 'queue'} className="min-h-0 flex-1">
            <QueuePanel session={session} view={view} onToast={toast} />
          </div>
          <div id="panel-people" role="tabpanel" aria-labelledby="tab-people" hidden={tab !== 'people'} className="min-h-0 flex-1">
            <PeoplePanel session={session} view={view} onToast={toast} />
          </div>

          <ReactionLane reactions={view.reactions} />
          {!railHidden && toastStack(`absolute inset-x-3 ${toastLift(tab)}`)}
        </aside>
      </div>
    </div>
  );
};

