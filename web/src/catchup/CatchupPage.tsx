import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type Media } from '../api/http';
import { useAccount } from '../auth/account';
import { createPlayer } from '../players/registry';
import type { PlayerAdapter } from '../players/types';
import { Wordmark } from '../ui/Wordmark';
import { catchupApi, type CrewVideo, type Moment } from './api';
import { Compose } from './Compose';
import { Density } from './Density';
import { createFiring } from './firing';
import { Rail } from './Rail';

const POLL_MS = 250;
const WAITING = 'Reactions show up here as the video reaches them.';
const NOBODY = 'Nobody reacted to this one yet. Your reactions will be here for the next person.';

type Props = { slug: string; itemId: string };

const home = (slug: string) => `/r/${encodeURIComponent(slug)}`;

const Frame = ({ slug, crewName, children }: { slug: string; crewName?: string; children: ReactNode }) => (
  <div className="flex min-h-full flex-col">
    <header className="h-14 shrink-0 border-b border-line">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6 phone:px-4">
        <a href="/" aria-label="Stream2Gather home">
          <Wordmark />
        </a>
        <a href={home(slug)} className="truncate text-sm text-muted">
          {crewName ?? 'Crew home'}
        </a>
      </div>
    </header>
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-6 pb-10 phone:px-4">{children}</main>
  </div>
);

/** A video's reactions, loaded once and fired as the video reaches them. */
const useMoments = (slug: string, video: CrewVideo) => {
  const firing = useRef(createFiring<Moment>([]));
  const [all, setAll] = useState<Moment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [passed, setPassed] = useState<Moment[]>([]);
  const [fired] = useState(() => new Map<number, number>());

  const load = useCallback(() => {
    setFailed(false);
    catchupApi.moments(slug, video.source, video.sourceId).then(
      (moments) => {
        firing.current = createFiring(moments);
        setAll(firing.current.all());
      },
      () => setFailed(true),
    );
  }, [slug, video.source, video.sourceId]);

  useEffect(load, [load]);

  const tick = useCallback(
    (adapter: PlayerAdapter) => {
      const time = adapter.time();
      const reached = firing.current.tick(time, adapter.state() === 'playing');
      for (const moment of reached) fired.set(moment.id, Math.round(time * 1000));
      setPassed((shown) => {
        const now = firing.current.passed();
        if (now.length === shown.length) return shown;
        // The rail moved with nothing reached: a seek. Those lines arrive quietly.
        if (reached.length === 0) fired.clear();
        return now;
      });
    },
    [fired],
  );

  const add = useCallback((moment: Moment) => {
    firing.current.add(moment);
    setAll([...firing.current.all()]);
    setPassed(firing.current.passed());
  }, []);

  return { all, failed, passed, fired, load, tick, add };
};

const openLabel = (media: Media) => (media.source === 'youtube' ? 'Open on YouTube' : 'Open the video');

const Watch = ({ slug, video, media }: { slug: string; video: CrewVideo; media: Media }) => {
  const { user } = useAccount();
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<PlayerAdapter | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState(false);
  const { all, failed, passed, fired, load, tick, add } = useMoments(slug, video);

  useEffect(() => {
    let live = true;
    const startAt = Number(new URLSearchParams(window.location.search).get('at') ?? 0) / 1000;
    createPlayer(host.current as HTMLElement, media, startAt, false).then(
      (player) => {
        if (!live) return player.destroy();
        adapter.current = player;
        player.onError(() => setBlocked(true));
      },
      () => live && setBlocked(true),
    );
    const poll = window.setInterval(() => adapter.current && tick(adapter.current), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(poll);
      adapter.current?.destroy();
      adapter.current = null;
    };
  }, [media, tick]);

  const send = async (part: { emoji?: string; body?: string }) => {
    const posMs = Math.round((adapter.current?.time() ?? 0) * 1000);
    const moment = { source: video.source, id: video.sourceId, posMs, ...part };
    setProblem(false);
    try {
      const { id } = await catchupApi.add(slug, moment).catch(() => catchupApi.add(slug, moment));
      add({ id, posMs, kind: part.body ? 'chat' : 'reaction', origin: 'catchup', author: user?.name ?? '', ...part });
    } catch {
      setProblem(true);
    }
  };

  const shown = blocked ? (all ?? []) : passed;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <h1 className="mb-3 truncate font-semibold">{media.title}</h1>
        {blocked ? (
          <p className="text-sm text-muted">
            This video won’t play here.{' '}
            <a href={media.url} target="_blank" rel="noreferrer" className="text-link">
              {openLabel(media)}
            </a>
          </p>
        ) : (
          <>
            <div ref={host} data-player className="aspect-video w-full overflow-hidden rounded-md bg-black" />
            <Density moments={all ?? []} lengthMs={media.durationMs} onSeek={(ms) => adapter.current?.seek(ms / 1000)} />
          </>
        )}
      </div>
      <section aria-label="Catch up" className="flex min-h-0 flex-col lg:h-[min(70dvh,560px)]">
        {failed && (
          <p className="text-sm text-muted">
            Couldn’t load reactions.{' '}
            <button type="button" onClick={load} className="text-link">
              Retry
            </button>
          </p>
        )}
        {all?.length === 0 && <p className="text-sm text-muted">{NOBODY}</p>}
        {all && all.length > 0 && shown.length === 0 && <p className="text-sm text-muted">{WAITING}</p>}
        <Rail moments={shown} fired={fired} className="max-h-72 flex-1 lg:max-h-none" />
        {!blocked && <Compose onSend={(part) => void send(part)} problem={problem} />}
        <p className="mt-3 text-xs text-dim">Reactions and watch stats come from Stream2Gather, not YouTube.</p>
      </section>
    </div>
  );
};

/** Watching what the crew watched, alone, with their reactions coming back as it plays. */
export default function CatchupPage({ slug, itemId }: Props) {
  const [video, setVideo] = useState<CrewVideo | 'gone' | null>(null);

  useEffect(() => {
    let live = true;
    catchupApi.item(slug, itemId).then(
      (found) => live && setVideo(found),
      (error: unknown) => {
        if (!live) return;
        // Members only: the room's own door says what to do next.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) window.location.replace(home(slug));
        else setVideo('gone');
      },
    );
    return () => {
      live = false;
    };
  }, [slug, itemId]);

  if (!video) return null;
  if (video === 'gone' || !video.media) {
    return (
      <Frame slug={slug} crewName={video === 'gone' ? undefined : video.crewName}>
        <p className="text-sm text-muted">Video unavailable</p>
      </Frame>
    );
  }
  return (
    <Frame slug={slug} crewName={video.crewName}>
      <Watch slug={slug} video={video} media={video.media} />
    </Frame>
  );
}
