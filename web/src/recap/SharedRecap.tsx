import { useEffect, useState, type CSSProperties } from 'react';
import { Page, SiteHeader } from '../ui/Page';
import { firstName, listNames, seatHue } from '../ui/people';
import { recapApi, type PublicRecap } from './api';
import { Track } from './Track';
import { DISCLOSURE, EmojiCounts, nightOf, plural, position, together, totalOf, whoReacted } from './words';

/** What fits across a phone and still shows a picture. The rest are named underneath. */
const STILLS = 4;
/** A bigger crew than this loses nothing: the sentence above counts them. */
const SEATS = 15;

type Video = PublicRecap['videos'][number];
type Biggest = NonNullable<PublicRecap['biggest']>;

const topEmoji = (emojis: Record<string, number>) => Object.entries(emojis).sort(([, a], [, b]) => b - a)[0]?.[0];

/** The video's own thumbnail. Without one, its name stands in on a dark frame. */
const Still = ({ video }: { video: Video }) => {
  const [broken, setBroken] = useState(false);
  const picture = video.thumbnailUrl && !broken ? <img src={video.thumbnailUrl} alt="" onError={() => setBroken(true)} /> : <span className="reel-name">{video.title || 'Video unavailable'}</span>;
  return video.title ? (
    <a href={video.url} target="_blank" rel="noreferrer" aria-label={video.title} className="reel-still">
      {picture}
    </a>
  ) : (
    <span className="reel-still">{picture}</span>
  );
};

/** The night left to right: what was on, and where everyone reacted to it. */
const Reel = ({ videos, biggest }: { videos: Video[]; biggest: Biggest | null }) => (
  <ol className="reel">
    {videos.slice(0, STILLS).map((video, index) => (
      <li key={index} className="min-w-0">
        <Still video={video} />
        {video.dots.length > 0 && (
          <span className="night-track">
            <Track dots={video.dots.map(({ at, seat }) => ({ left: at, color: seatHue(seat) }))}>
              {biggest?.video === index && biggest.at > 0 && (
                <span style={{ left: `${biggest.at}%` }} className="reel-best">
                  {topEmoji(biggest.emojis)}
                </span>
              )}
            </Track>
          </span>
        )}
      </li>
    ))}
  </ol>
);

/** Everyone who came, on one row, and the seat that's still free. Colours only: no seat says who it is. */
const Row = ({ count }: { count: number }) => (
  <div role="img" aria-label={`${plural(count, 'seat')} taken, and one free`} className="poster-row">
    <span className="poster-seats">
      {Array.from({ length: Math.min(count, SEATS) }, (_, seat) => (
        <span key={seat} style={{ '--hue': seatHue(seat) } as CSSProperties} className="poster-seat" />
      ))}
      <span data-free="true" className="poster-seat" />
    </span>
    <span className="poster-bench" />
  </div>
);

/** What a crew chose to show the world: a picture of the night. No player here, and never any chat. */
export default function SharedRecap({ token }: { token: string }) {
  const [recap, setRecap] = useState<PublicRecap | null | 'gone'>(null);

  useEffect(() => {
    let live = true;
    recapApi.shared(token).then(
      (read) => live && setRecap(read),
      () => live && setRecap('gone'),
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (!recap) return null;
  if (recap === 'gone') {
    return (
      <Page status>
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em]">This recap isn’t shared</h1>
        <p className="mt-1.5 text-muted">Whoever shared it has taken it back. That night stays with the people who were there.</p>
        <a href="/" className="btn btn-primary mt-5">
          Start your own room
        </a>
      </Page>
    );
  }

  const reactions = totalOf(recap.reactions);
  const names = recap.people.map(firstName);
  const dotted = recap.videos.some(({ dots }) => dots.length > 0);
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-8 pb-10 phone:px-4 phone:pt-5">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em] text-balance">
          {nightOf(recap.startedAt)} with {recap.crewName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {listNames(names)} watched together for <span className="tabular-nums">{together(recap.wallMs)}</span>
          {reactions > 0 && <>, and reacted <span className="tabular-nums">{plural(reactions, 'time')}</span></>}.
        </p>

        <Reel videos={recap.videos} biggest={recap.biggest} />
        <Row count={recap.people.length} />
        <p className="mt-2 text-[13px] text-dim">A seat for everyone who came.{dotted && ' Each dot is one of them reacting.'}</p>

        {recap.biggest && (
          <div className="night-moment text-sm">
            <p className="text-muted">
              {whoReacted(recap.biggest.people, recap.people.length, false)} at <span className="tabular-nums">{position(recap.biggest.posMs)}</span> in {recap.biggest.title || 'Video unavailable'}
            </p>
            <p className="mt-1">
              <EmojiCounts counts={recap.biggest.emojis} />
            </p>
          </div>
        )}

        {recap.videos.length > STILLS && (
          <ol className="mt-4 divide-y divide-line border-y border-line text-sm">
            {recap.videos.slice(STILLS).map((video, index) => (
              <li key={index} className="truncate py-2">
                {video.title ? (
                  <a href={video.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {video.title}
                  </a>
                ) : (
                  <span className="text-muted">Video unavailable</span>
                )}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-4 phone:flex-col phone:items-stretch">
          <p className="text-[15px] font-medium">Save your friends a seat.</p>
          <a href="/" className="btn btn-primary shrink-0">
            Start your own room
          </a>
        </div>
        <p className="mt-4 text-xs text-dim">{DISCLOSURE}</p>
      </main>
    </div>
  );
}
