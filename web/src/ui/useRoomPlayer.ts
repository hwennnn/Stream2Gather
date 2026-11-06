import { useEffect, useRef, useState } from 'react';
import { watchAutoplay } from '../players/autoplay';
import { createHtml5Player } from '../players/html5';
import type { PlayerAdapter, PlayerError } from '../players/types';
import { createYouTubePlayer } from '../players/youtube';
import type { QueueItem, RoomSession, RoomView } from '../room/session';
import { track } from '../room/telemetry';
import { expectedPosition, SyncController, type SyncReport } from '../sync/controller';

declare global {
  interface Window {
    __s2g?: { sample: () => { serverNow: number; time: number; state: string; expected: number; health: string } };
  }
}

/** A sliver of drift is normal. Only this much, for this long, is worth a label. */
const BEHIND_S = 1;
const BEHIND_FOR_MS = 3000;
const LOAD_TIMEOUT_MS = 20_000;
/** Some browsers won't fetch a file until play is pressed, so the poster can't wait for it. */
const POSTER_LIMIT_MS = 8000;

const createPlayer = (element: HTMLElement, item: QueueItem, startAt: number) =>
  item.source === 'youtube'
    ? createYouTubePlayer(element, item.sourceId, startAt)
    : createHtml5Player(element, item.url, startAt);

type Events = {
  onPlayer: (player: PlayerAdapter | null) => void;
  onReady: () => void;
  onFailure: (error: PlayerError) => void;
  onReport: (report: SyncReport) => void;
  onMuted: (muted: boolean) => void;
};

type Cleanup = () => void;

const watchFirstFrame = (player: PlayerAdapter, item: QueueItem): Cleanup => {
  const mountedAt = performance.now();
  const timer = window.setInterval(() => {
    if (player.state() === 'playing' && player.time() > 0) {
      window.clearInterval(timer);
      track({ name: 'first_frame_ms', value: performance.now() - mountedAt, source: item.source });
    }
  }, 200);
  return () => window.clearInterval(timer);
};

/** YouTube is ready once its own loader shows. A file is ready once it can play. */
const watchReady = (player: PlayerAdapter, item: QueueItem, onReady: () => void): Cleanup => {
  if (item.source === 'youtube' || player.state() !== 'loading') {
    onReady();
    return () => {};
  }
  const startedAt = performance.now();
  const timer = window.setInterval(() => {
    if (player.state() === 'loading' && performance.now() - startedAt < POSTER_LIMIT_MS) return;
    window.clearInterval(timer);
    onReady();
  }, 100);
  return () => window.clearInterval(timer);
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

/** Small corrections happen all the time and don't need the viewer's attention. */
const settle = (report: SyncReport, behindSince: number | null): SyncReport['health'] => {
  if (report.health !== 'correcting') return report.health;
  return behindSince !== null && Date.now() - behindSince >= BEHIND_FOR_MS ? 'correcting' : 'synced';
};

const startSync = (session: RoomSession, player: PlayerAdapter, item: QueueItem, events: Events): Cleanup => {
  let health = 'waiting';
  let behindSince: number | null = null;

  const sync = new SyncController(
    player,
    session.clock,
    // The item this player loaded, not the room's latest: a late event from
    // this video must not land on the next one.
    (command) => session.send(command.type, { ...command, item: item.id }),
    (report) => {
      health = report.health;
      behindSince = Math.abs(report.drift) > BEHIND_S ? (behindSince ?? Date.now()) : null;
      const settled = settle(report, behindSince);
      events.onReport({ ...report, health: settled });
      session.reportStatus(settled, report.drift);
    },
  );

  session.onPlayback((playback, resync) => sync.apply(playback, resync));
  sync.apply(session.getView().playback);

  const timer = window.setInterval(() => {
    sync.tick();
    events.onMuted(player.muted());
    const playback = session.getView().playback;
    if (playback.status === 'playing') {
      const drift = player.time() - expectedPosition(playback, session.clock.now());
      track({ name: 'drift_ms', value: Math.abs(drift) * 1000, source: item.source });
    }
  }, 1000);

  const stopExposing = exposeForTests(session, player, () => health);

  return () => {
    window.clearInterval(timer);
    stopExposing();
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

  const startAt = expectedPosition(session.getView().playback, session.clock.now());
  createPlayer(mount, item, startAt).then(
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
        watchReady(created, item, events.onReady),
        watchFirstFrame(created, item),
        watchAutoplay(() => session.getView().playback.status === 'playing', created, events.onMuted),
        startSync(session, created, item, events),
      );
    },
    () => fail({ kind: 'network', code: 0 }),
  );

  return remove;
};

export type RoomPlayer = {
  stage: React.RefObject<HTMLDivElement | null>;
  report: SyncReport;
  ready: boolean;
  failure: PlayerError | null;
  muted: boolean;
  unmute: () => void;
};

/** Keeps a player on the stage for whatever the room is watching. */
export const useRoomPlayer = (session: RoomSession, view: RoomView): RoomPlayer => {
  const stage = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<SyncReport>({ health: 'waiting', drift: 0 });
  const [readyId, setReadyId] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; error: PlayerError } | null>(null);
  const [muted, setMuted] = useState(false);
  const player = useRef<PlayerAdapter | null>(null);

  const current = view.queue[0];
  const currentId = view.playback.item ? current?.id : undefined;

  useEffect(() => {
    if (!stage.current || !current || !currentId) return undefined;
    setReport({ health: 'waiting', drift: 0 });
    setMuted(false);
    return mountPlayer(stage.current, session, current, {
      onPlayer: (next) => {
        player.current = next;
      },
      onReady: () => setReadyId(currentId),
      onFailure: (error) => setFailed({ id: currentId, error }),
      onReport: setReport,
      onMuted: setMuted,
    });
    // A new queue item is the only thing that replaces the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, session]);

  return {
    stage,
    report,
    ready: readyId === currentId,
    failure: failed && failed.id === currentId ? failed.error : null,
    muted,
    unmute: () => {
      player.current?.setMuted(false);
      setMuted(false);
    },
  };
};
