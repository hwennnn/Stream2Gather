import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { watchAutoplay } from '../players/autoplay';
import { createPlayer } from '../players/registry';
import { notStarted, type PlayerAdapter, type PlayerError, type PlayerState } from '../players/types';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { track } from '../room/telemetry';
import { expectedPosition, SyncController, type SyncReport } from '../sync/controller';

declare global {
  interface Window {
    __s2g?: { sample: () => { serverNow: number; time: number; state: string; expected: number; health: string } };
  }
}

const LOAD_TIMEOUT_MS = 20_000;
/** A player can sit unstarted until it's pressed, so the poster can't wait for it. */
const POSTER_LIMIT_MS = 8000;

type Events = {
  onPlayer: (player: PlayerAdapter | null) => void;
  onReady: () => void;
  onFailure: (error: PlayerError) => void;
  onReport: (report: SyncReport) => void;
  onMuted: (muted: boolean) => void;
  onRefused: (refused: boolean) => void;
  onCold: (cold: boolean) => void;
  onStarted: () => void;
};

type Cleanup = () => void;

export const watchFirstFrame = (player: PlayerAdapter, item: QueueItem, onPlayed: () => void): Cleanup => {
  const mountedAt = performance.now();
  const timer = window.setInterval(() => {
    if (player.state() === 'playing' && player.time() > 0) {
      window.clearInterval(timer);
      track({ name: 'first_frame_ms', value: performance.now() - mountedAt, source: item.source });
      onPlayed();
    }
  }, 200);
  return () => window.clearInterval(timer);
};

/** Buffering can't be waiting for a click, so it may take as long as a load may. */
const nothingToShow = (state: PlayerState, waited: number): boolean =>
  state === 'buffering' ? waited < LOAD_TIMEOUT_MS : state === 'loading' && waited < POSTER_LIMIT_MS;

/**
 * Keeps the poster up until the player has a picture of its own. YouTube's iframe
 * is black until then. This checks every frame, because the poster must be gone
 * as soon as a video plays: nothing may be drawn over one.
 */
export const watchReady = (player: PlayerAdapter, onReady: () => void): Cleanup => {
  const startedAt = performance.now();
  let frame = 0;
  const check = () => {
    if (nothingToShow(player.state(), performance.now() - startedAt)) frame = requestAnimationFrame(check);
    else onReady();
  };
  check();
  return () => cancelAnimationFrame(frame);
};

const exposeForTests = (session: RoomSession, player: PlayerAdapter, health: () => string): Cleanup => {
  if (!navigator.webdriver) return () => {};
  window.__s2g = {
    sample: () => ({
      serverNow: session.clock.now(),
      time: player.time(),
      state: player.state(),
      expected: expectedPosition(session.getView().playback, session.clock.now()),
      health: health(),
    }),
  };
  return () => {
    window.__s2g = undefined;
  };
};

const startSync = (session: RoomSession, player: PlayerAdapter, item: QueueItem, events: Events): Cleanup => {
  let health = 'waiting';

  const sync = new SyncController(
    player,
    session.clock,
    // The item this player loaded, not the room's latest: a late event from
    // this video must not land on the next one.
    (command) => session.send(command.type, { ...command, item: item.id }),
    (report) => {
      health = report.health;
      events.onReport(report);
      session.reportStatus(report.health, report.drift);
    },
  );

  session.onPlayback((playback, resync) => sync.apply(playback, resync));
  sync.apply(session.getView().playback);
  const stopWatchingAutoplay = watchAutoplay(
    () => session.getView().playback.status === 'playing',
    () => sync.stoppedOnPurpose(),
    player,
    events.onMuted,
    events.onRefused,
  );

  const noteCold = () => events.onCold(session.getView().playback.status === 'paused' && notStarted(player.state()));
  noteCold();

  const timer = window.setInterval(() => {
    sync.tick();
    events.onMuted(player.muted());
    noteCold();
    const playback = session.getView().playback;
    if (playback.status === 'playing' && !item.isLive) {
      const drift = player.time() - expectedPosition(playback, session.clock.now());
      track({ name: 'drift_ms', value: Math.abs(drift) * 1000, source: item.source });
    }
  }, 1000);

  const stopExposing = exposeForTests(session, player, () => health);

  return () => {
    window.clearInterval(timer);
    stopExposing();
    stopWatchingAutoplay();
    sync.destroy();
    session.onPlayback(() => {});
  };
};

/** Puts one player on the stage. The returned cleanup removes that player and nothing else. */
const mountPlayer = (stage: HTMLElement, session: RoomSession, item: QueueItem, events: Events): Cleanup => {
  const mount = document.createElement('div');
  mount.className = 'h-full w-full';
  stage.append(mount);

  const cleanups: Cleanup[] = [];
  let player: PlayerAdapter | null = null;
  let gone = false;

  const remove = () => {
    if (gone) return;
    gone = true;
    window.clearTimeout(timeout);
    for (const cleanup of cleanups) cleanup();
    events.onPlayer(null);
    player?.destroy();
    mount.remove();
  };

  const fail = (error: PlayerError) => {
    if (gone) return;
    remove(); // The panel replaces the player. It is never drawn over it.
    events.onFailure(error);
    session.send('media_error', { item: item.id, kind: error.kind, code: error.code });
    track({ name: 'player_error', value: error.code, source: item.source, detail: item.sourceId });
  };

  const timeout = window.setTimeout(() => fail({ kind: 'network', code: 0 }), LOAD_TIMEOUT_MS);

  const { playback } = session.getView();
  const startAt = expectedPosition(playback, session.clock.now());
  createPlayer(mount, item, startAt, playback.status === 'playing').then(
    (created) => {
      if (gone) {
        created.destroy();
        return;
      }
      window.clearTimeout(timeout);
      player = created;
      events.onPlayer(created);
      created.onError(fail);
      cleanups.push(
        watchReady(created, events.onReady),
        watchFirstFrame(created, item, () => {
          events.onStarted();
          session.send('media_ok', { item: item.id });
        }),
        startSync(session, created, item, events),
      );
    },
    () => fail({ kind: 'network', code: 0 }),
  );

  return remove;
};

const WAITING: SyncReport = { health: 'waiting', drift: 0 };

type ReportStore = { get: () => SyncReport; set: (report: SyncReport) => void; subscribe: (listener: () => void) => () => void };

/** A report lands every second, so it must not pass through the room's own state. */
const createReportStore = (): ReportStore => {
  let report = WAITING;
  const listeners = new Set<() => void>();
  return {
    get: () => report,
    set: (next) => {
      report = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/** For whatever shows the report, so that nothing else redraws with it. */
export const useSyncReport = ({ reports }: RoomPlayer): SyncReport => useSyncExternalStore(reports.subscribe, reports.get);

export type RoomPlayer = {
  stage: React.RefObject<HTMLDivElement | null>;
  /** The player on the stage now, for anything outside sync that needs one. */
  adapter: () => PlayerAdapter | null;
  reports: ReportStore;
  ready: boolean;
  /** This player has shown a frame of this video. */
  started: boolean;
  failure: PlayerError | null;
  muted: boolean;
  /** The browser refused to start this player, even muted. */
  refused: boolean;
  /** The room is paused and this player has not started, so it has no frame or controls yet. */
  cold: boolean;
  unmute: () => void;
  /** Loads the same video again in place. The room carries on meanwhile. */
  retry: () => void;
};

/** Keeps a player on the stage for whatever the room is watching. */
export const useRoomPlayer = (session: RoomSession, view: RoomView): RoomPlayer => {
  const stage = useRef<HTMLDivElement>(null);
  const reports = useMemo(createReportStore, []);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [startedId, setStartedId] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; error: PlayerError } | null>(null);
  const [muted, setMuted] = useState(false);
  const [refused, setRefused] = useState(false);
  const [cold, setCold] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const player = useRef<PlayerAdapter | null>(null);

  const current = view.queue[0];
  const currentId = view.playback.item ? current?.id : undefined;

  useEffect(() => {
    if (!stage.current || !current || !currentId) return undefined;
    reports.set(WAITING);
    setStartedId(null);
    setMuted(false);
    setRefused(false);
    setCold(false);
    return mountPlayer(stage.current, session, current, {
      onPlayer: (next) => {
        player.current = next;
      },
      onReady: () => setReadyId(currentId),
      onFailure: (error) => setFailed({ id: currentId, error }),
      onReport: reports.set,
      onMuted: setMuted,
      onRefused: setRefused,
      onCold: setCold,
      onStarted: () => setStartedId(currentId),
    });
    // Only a new queue item or a retry replaces the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, session, attempt]);

  return {
    stage,
    adapter: () => player.current,
    reports,
    ready: readyId === currentId,
    started: startedId === currentId,
    failure: failed && failed.id === currentId ? failed.error : null,
    muted,
    refused,
    cold,
    unmute: () => {
      player.current?.setMuted(false);
      setMuted(false);
    },
    retry: () => {
      setFailed(null);
      setAttempt((count) => count + 1);
    },
  };
};
