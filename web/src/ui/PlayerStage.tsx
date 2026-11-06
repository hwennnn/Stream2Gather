import { useEffect, useRef, useState } from 'react';
import { createHtml5Player } from '../players/html5';
import type { PlayerAdapter, PlayerError } from '../players/types';
import { createYouTubePlayer } from '../players/youtube';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { track } from '../room/telemetry';
import { expectedPosition, SyncController, type SyncHealth, type SyncReport } from '../sync/controller';
import { Omnibox } from './Omnibox';

declare global {
  interface Window {
    __s2g?: { sample: () => { serverNow: number; time: number; state: string; expected: number; health: string } };
  }
}

const REACTIONS = ['😂', '❤️', '🔥', '😮', '👏', '😭'];

const HEALTH_TEXT: Record<SyncHealth, string> = {
  synced: 'In sync',
  correcting: 'Catching up',
  buffering: 'Buffering',
  waiting: 'Starting together',
  stalled: 'Ad or pause, room continues',
};

const createPlayer = (element: HTMLElement, item: QueueItem, startAt: number) =>
  item.source === 'youtube'
    ? createYouTubePlayer(element, item.sourceId, startAt)
    : createHtml5Player(element, item.url, startAt);

type StageProps = { session: RoomSession; view: RoomView };

export const PlayerStage = ({ session, view }: StageProps) => {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<SyncController | null>(null);
  const adapter = useRef<PlayerAdapter | null>(null);
  const [report, setReport] = useState<SyncReport>({ health: 'waiting', drift: 0 });
  const [failure, setFailure] = useState<PlayerError | null>(null);
  const [muted, setMuted] = useState(false);

  const current = view.queue[0];
  const currentId = view.playback.item ? current?.id : undefined;

  useEffect(() => {
    if (!host.current || !current || !currentId) return undefined;
    let cancelled = false;
    let timer: number | null = null;
    const mountedAt = performance.now();
    setFailure(null);

    const startAt = expectedPosition(session.getView().playback, session.clock.now());
    void createPlayer(host.current, current, startAt).then((player) => {
      if (cancelled) {
        player.destroy();
        return;
      }
      adapter.current = player;

      const sync = new SyncController(
        player,
        session.clock,
        (command) => {
          const item = session.getView().playback.item;
          session.send(command.type, { ...command, item });
        },
        (next) => {
          setReport(next);
          session.reportStatus(next.health, next.drift);
        },
      );
      controller.current = sync;

      player.onError((error) => {
        setFailure(error);
        session.send('media_error', { item: currentId, kind: error.kind, code: error.code });
        track({ name: 'player_error', value: error.code, source: current.source, detail: current.sourceId });
      });

      let reportedFrame = false;
      const firstFrame = window.setInterval(() => {
        if (player.state() === 'playing' && player.time() > 0 && !reportedFrame) {
          reportedFrame = true;
          window.clearInterval(firstFrame);
          track({ name: 'first_frame_ms', value: performance.now() - mountedAt, source: current.source });
        }
      }, 200);

      // Browsers can refuse sound without a gesture. Muted is better than stuck.
      window.setTimeout(() => {
        if (!cancelled && session.getView().playback.status === 'playing' && player.state() !== 'playing') {
          player.setMuted(true);
          player.play();
          setMuted(true);
        }
      }, 2500);

      session.onPlayback((playback) => sync.apply(playback));
      sync.apply(session.getView().playback);

      timer = window.setInterval(() => {
        sync.tick();
        const playback = session.getView().playback;
        if (playback.status === 'playing') {
          const drift = player.time() - expectedPosition(playback, session.clock.now());
          track({ name: 'drift_ms', value: Math.abs(drift) * 1000, source: current.source });
        }
      }, 1000);

      window.__s2g = {
        sample: () => ({
          serverNow: session.clock.now(),
          time: player.time(),
          state: player.state(),
          expected: expectedPosition(session.getView().playback, session.clock.now()),
          health: lastHealth.current,
        }),
      };
    });

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      controller.current?.destroy();
      controller.current = null;
      adapter.current?.destroy();
      adapter.current = null;
      session.onPlayback(() => {});
    };
    // A new queue item is the only thing that replaces the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, session]);

  const lastHealth = useRef<string>('waiting');
  lastHealth.current = report.health;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <div className="relative aspect-video w-full bg-black lg:max-h-[calc(100dvh-140px)]">
        <div ref={host} className="h-full w-full" />

        {!current && <EmptyStage session={session} />}

        {failure && current && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel px-6 text-center">
            <div>
              <h2 className="text-xl font-semibold">This video won’t play here</h2>
              <p className="mt-2 max-w-md text-muted">
                {failure.kind === 'embed_blocked'
                  ? 'Its owner only allows it on YouTube. Everyone else’s video and chat keep going.'
                  : 'It may have been removed, or it isn’t available where you are.'}
              </p>
              <a
                href={current.url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block rounded-lg bg-raised px-4 py-2 text-sm font-medium hover:brightness-125"
              >
                Open on YouTube
              </a>
            </div>
          </div>
        )}
      </div>

      {current && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="truncate text-[15px] font-semibold">{current.title}</h2>
            <p className="truncate text-sm text-muted">
              {current.author}
              {view.activity ? ` · ${view.activity}` : ''}
            </p>
          </div>

          <SyncPill health={report.health} drift={report.drift} />

          {muted && (
            <button
              type="button"
              onClick={() => {
                adapter.current?.setMuted(false);
                setMuted(false);
              }}
              className="cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-ink"
            >
              Tap to unmute
            </button>
          )}

          <button
            type="button"
            onClick={() => session.send('skip', { item: view.playback.item })}
            className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised"
          >
            Skip
          </button>

          <Reactions session={session} view={view} />
        </div>
      )}
    </div>
  );
};

const SyncPill = ({ health, drift }: { health: SyncHealth; drift: number }) => {
  const good = health === 'synced';
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-muted">
      <span className={`size-2 rounded-full ${good ? 'bg-good' : 'bg-warn'}`} />
      {HEALTH_TEXT[health]}
      {good && ` · ${Math.round(Math.abs(drift) * 1000)}ms`}
    </span>
  );
};

/** Reactions float over this bar. Nothing may cover the YouTube player. */
const Reactions = ({ session, view }: StageProps) => (
  <div className="relative flex gap-0.5">
    {REACTIONS.map((emoji) => (
      <button
        key={emoji}
        type="button"
        aria-label={`React ${emoji}`}
        onClick={() => session.send('react', { emoji })}
        className="size-8 cursor-pointer rounded-lg text-lg transition hover:scale-110 hover:bg-raised"
      >
        {emoji}
      </button>
    ))}
    {view.reactions.map((reaction, index) => (
      <span
        key={reaction.id}
        aria-hidden="true"
        style={{ right: `${(index * 37) % 180}px` }}
        className="reaction pointer-events-none absolute bottom-0 text-2xl"
      >
        {reaction.emoji}
      </span>
    ))}
  </div>
);

const EmptyStage = ({ session }: { session: RoomSession }) => (
  <div className="glow absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
    <h2 className="text-2xl font-semibold">What are we watching?</h2>
    <p className="mt-2 mb-5 text-muted">Paste a link or search YouTube.</p>
    <div className="w-full max-w-xl">
      <Omnibox session={session} />
    </div>
  </div>
);
