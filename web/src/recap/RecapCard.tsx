import { useEffect, useState } from 'react';
import { catchupApi, type Moment } from '../catchup/api';
import { Avatar } from '../ui/Avatar';
import { initials } from '../ui/format';
import { firstName, hueOf } from '../ui/people';
import { Thumb } from '../ui/Thumb';
import { recapApi, type Recap } from './api';
import { dotsOf, wordsAround } from './night';
import { EmojiCounts, nightOf, plural, position, together, totalOf, whoReacted } from './words';

/** Starts ten seconds early, so the moment has its lead-in. */
const LEAD_IN_MS = 10_000;
/** Each video's reactions are a read, so a long night stops drawing lines here. */
const WITH_TRACKS = 8;

export type NightPerson = { userId?: string; name: string };

const keyOf = (source: string, sourceId: string) => `${source}:${sourceId}`;

const Share = ({ slug, recap }: { slug: string; recap: Recap }) => {
  const [url, setUrl] = useState(recap.shareUrl);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const change = (on: boolean) => {
    setFailed(false);
    setCopied(false);
    recapApi.share(slug, recap.sessionId, on).then(
      (reply) => setUrl(reply.url),
      () => setFailed(true),
    );
  };
  const copy = async () => {
    await navigator.clipboard.writeText(url ?? '').catch(() => {});
    setCopied(true);
  };

  return (
    <div className="mt-3">
      {url ? (
        <>
          <div className="flex gap-2">
            <label htmlFor={`share-${recap.sessionId}`} className="sr-only">
              Recap link
            </label>
            <input id={`share-${recap.sessionId}`} readOnly value={url} className="field min-w-0 flex-1 font-mono text-[13px]" />
            <button type="button" onClick={() => void copy()} className="btn btn-quiet shrink-0">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" onClick={() => change(false)} className="btn btn-ghost btn-sm mt-1 -ml-2.5">
            Stop sharing
          </button>
        </>
      ) : (
        <button type="button" onClick={() => change(true)} className="btn btn-quiet btn-sm">
          Share this recap
        </button>
      )}
      {failed && (
        <p role="status" className="mt-1 text-sm text-warn">
          That didn’t go through. Try again.
        </p>
      )}
    </div>
  );
};

/** Each face in its person's hue. A former member has no id, so theirs stays neutral. */
export const PastFace = ({ person, className }: { person: NightPerson; className: string }) =>
  person.userId ? (
    <Avatar person={{ userId: person.userId, name: person.name }} className={className} />
  ) : (
    <span title={person.name} className={`inline-flex items-center justify-center rounded-full bg-raised font-semibold text-muted ${className}`}>
      {initials(person.name)}
    </span>
  );

/** Who sat down. A name can run long, so the seat keeps the first of it. */
const WhoCame = ({ people }: { people: NightPerson[] }) => (
  <ul aria-label="Who came" data-kept="true" className="seats mt-3">
    {people.map((person, index) => (
      <li key={index} className="seat">
        <span className="seat-disc">
          <PastFace person={person} className="size-full" />
        </span>
        <span className="seat-name">{firstName(person.name)}</span>
      </li>
    ))}
  </ul>
);

const Track = ({ moments, lengthMs }: { moments: Moment[]; lengthMs: number }) => {
  const dots = dotsOf(moments, lengthMs);
  if (dots.length === 0) return null;
  return (
    <span aria-hidden="true" className="night-track">
      <span className="seat-track-line">
        {dots.map(({ left, color }, index) => (
          <span key={index} style={{ left: `${left}%`, backgroundColor: color }} className="seat-track-dot" />
        ))}
      </span>
    </span>
  );
};

const Video = ({ video, moments }: { video: Recap['items'][number]; moments?: Moment[] }) => (
  <li className="flex items-center gap-3 py-2">
    <Thumb src={video.media?.thumbnailUrl ?? ''} className="w-20 rounded-md" />
    <span className="min-w-0 flex-1">
      <span className={`block truncate text-sm ${video.media ? '' : 'text-muted'}`}>{video.media?.title ?? 'Video unavailable'}</span>
      {moments && <Track moments={moments} lengthMs={video.media?.durationMs ?? 0} />}
    </span>
  </li>
);

/** The densest stretch of the night, and what people said in it. */
const BestBit = ({ slug, recap, words }: { slug: string; recap: Recap; words: Moment[] }) => {
  const biggest = recap.biggest;
  if (!biggest) return null;
  const from = Math.max(biggest.posMs - LEAD_IN_MS, 0);
  return (
    <div className="night-moment text-sm">
      <p className="text-muted">
        {whoReacted(biggest.people, recap.people.length, recap.attended)} at <span className="tabular-nums">{position(biggest.posMs)}</span> in {biggest.media?.title ?? 'Video unavailable'}
      </p>
      <p className="mt-1">
        <EmojiCounts counts={biggest.emojis} />
      </p>
      {words.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {words.map((line) => (
            <li key={line.id} className="[overflow-wrap:anywhere]">
              <span style={{ color: line.userId ? hueOf(line.userId) : undefined }} className="mr-1.5 font-semibold">
                {firstName(line.author)}
              </span>
              {line.body}
            </li>
          ))}
        </ul>
      )}
      {biggest.itemId && (
        <a href={`/r/${encodeURIComponent(slug)}/catchup/${biggest.itemId}?at=${from}`} className="mt-2 inline-block text-link">
          Relive it
        </a>
      )}
    </div>
  );
};

/** Who reacted where, for someone who was there. Anyone else still has it all to come. */
const useMoments = (slug: string, recap: Recap | null): Map<string, Moment[]> => {
  const [found, setFound] = useState(new Map<string, Moment[]>());
  useEffect(() => {
    if (!recap?.attended || recap.building) return undefined;
    let live = true;
    const videos = recap.items.filter(({ media, sourceId }) => media && sourceId).slice(0, WITH_TRACKS);
    void Promise.all(
      videos.map(({ source, sourceId }) =>
        catchupApi.moments(slug, source, sourceId).then(
          (moments): [string, Moment[]] => [keyOf(source, sourceId), moments],
          (): [string, Moment[]] => [keyOf(source, sourceId), []], // The title still says what was on.
        ),
      ),
    ).then((pairs) => live && setFound(new Map(pairs)));
    return () => {
      live = false;
    };
  }, [recap, slug]);
  return found;
};

type Props = {
  slug: string;
  sessionId: string;
  /** Who was there with their ids, when the page has them, so each keeps their colour. */
  people?: NightPerson[];
  /** Off under a row that already names the night. */
  titled?: boolean;
};

/** One night, as the people there would tell it: who came, what was on, and the bit they'd bring up. */
export const RecapCard = ({ slug, sessionId, people, titled = true }: Props) => {
  const [recap, setRecap] = useState<Recap | null>(null);
  const moments = useMoments(slug, recap);

  useEffect(() => {
    let live = true;
    recapApi.read(slug, sessionId).then(
      (read) => live && setRecap(read),
      () => {}, // The row in Sessions still says what happened.
    );
    return () => {
      live = false;
    };
  }, [slug, sessionId]);

  if (!recap) return null;
  if (recap.building) return <p className="mt-6 text-sm text-muted">Your recap is on its way.</p>;

  const reactions = totalOf(recap.reactions);
  const time = <span className="tabular-nums">{together(recap.wallMs)}</span>;
  const biggest = recap.biggest;
  const words = biggest ? wordsAround(moments.get(keyOf(biggest.source, biggest.sourceId)) ?? [], biggest.posMs) : [];

  return (
    <section aria-label="Recap" className={titled ? 'mt-8' : 'mt-1 mb-3'}>
      {titled && <h2 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{nightOf(recap.startedAt)}</h2>}
      <p className="mt-0.5 text-sm text-muted">
        {biggest ? <>{time} together.</> : <>A quiet one. {plural(recap.items.length, 'video')}, {time} together.</>}
        {!recap.attended && ' You missed this one.'}
      </p>
      <WhoCame people={people ?? recap.people} />
      <ol className="mt-3 divide-y divide-line border-y border-line">
        {recap.items.map((item, index) => (
          <Video key={index} video={item} moments={moments.get(keyOf(item.source, item.sourceId))} />
        ))}
      </ol>
      <BestBit slug={slug} recap={recap} words={words} />
      {reactions > 0 && <p className="mt-3 text-[13px] text-dim">{plural(reactions, 'reaction')}</p>}
      {recap.attended && <Share slug={slug} recap={recap} />}
    </section>
  );
};
