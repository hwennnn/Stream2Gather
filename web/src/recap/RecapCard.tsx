import { useEffect, useState } from 'react';
import { recapApi, type Recap } from './api';
import { EmojiCounts, plural, position, together, totalOf } from './words';

/** Starts ten seconds early, so the moment has its lead-in. */
const LEAD_IN_MS = 10_000;

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

const Moment = ({ slug, recap }: { slug: string; recap: Recap }) => {
  const biggest = recap.biggest;
  if (!biggest) return null;
  const from = Math.max(biggest.posMs - LEAD_IN_MS, 0);
  return (
    <div className="mt-3 text-sm">
      <p className="text-muted">
        Biggest moment, <span className="fig text-[13px]">{position(biggest.posMs)}</span> in {biggest.media?.title ?? 'Video unavailable'}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3">
        <EmojiCounts counts={biggest.emojis} />
        {biggest.itemId && (
          <a href={`/r/${encodeURIComponent(slug)}/catchup/${biggest.itemId}?at=${from}`} className="text-link">
            Relive it
          </a>
        )}
      </p>
    </div>
  );
};

/** One session's recap, in the crew's own words. */
export const RecapCard = ({ slug, sessionId }: { slug: string; sessionId: string }) => {
  const [recap, setRecap] = useState<Recap | null>(null);

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
  const time = together(recap.wallMs);
  return (
    <section aria-label="Recap" className="mt-6 border-y border-line py-4">
      <p className="text-sm">{recap.people.map((person) => person.name).join(', ')}</p>
      {recap.biggest ? (
        <p className="mt-0.5 text-sm text-muted">
          <span className="fig text-[13px]">{time}</span> together
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-muted">
          A quiet one. {plural(recap.items.length, 'video')}, <span className="fig text-[13px]">{time}</span> together.
        </p>
      )}
      <ol className="mt-3 text-sm">
        {recap.items.map((item, index) => (
          <li key={index} className="truncate py-0.5">
            {item.media?.title ?? 'Video unavailable'}
          </li>
        ))}
      </ol>
      {reactions > 0 && <p className="mt-3 text-sm text-muted">{plural(reactions, 'reaction')}</p>}
      <Moment slug={slug} recap={recap} />
      {recap.attended && <Share slug={slug} recap={recap} />}
    </section>
  );
};
