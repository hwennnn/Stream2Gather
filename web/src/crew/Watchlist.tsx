import { useMemo, useState } from 'react';
import { ApiError, type Media } from '../api/http';
import { Icon } from '../ui/Icon';
import { AddBox, SearchResults, useSearch } from '../ui/Omnibox';
import { firstName } from '../ui/people';
import { Thumb } from '../ui/Thumb';
import type { Adder } from '../ui/useAdder';
import { crewApi, type WatchItem } from './api';

type Props = { slug: string; items: WatchItem[]; selfId?: string; onChange: () => void };

/** Who to thank for a video. What you added yourself needs no credit. */
const creditFor = ({ addedBy }: WatchItem, selfId?: string): string | null =>
  addedBy && addedBy.userId !== selfId ? `Added by ${firstName(addedBy.name)}` : null;

/** The credit keeps its place however long the channel's name runs. */
const Byline = ({ author, credit }: { author?: string; credit: string | null }) => {
  if (!author && !credit) return null;
  return (
    <span className="flex gap-1 text-xs text-dim">
      {author && <span className="truncate">{author}</span>}
      {author && credit && <span aria-hidden="true">·</span>}
      {credit && <span className="shrink-0">{credit}</span>}
    </span>
  );
};

/** The omnibox, pointed at the crew's list instead of a room's queue. */
const useWatchAdder = ({ slug, items, onChange }: Props): Adder => {
  const [problem, setProblem] = useState<string | null>(null);
  return useMemo(() => {
    const add = async (url: string) => {
      setProblem(null);
      try {
        await crewApi.addWatch(slug, { url });
        onChange();
        return true;
      } catch (error) {
        setProblem(error instanceof ApiError ? error.message : 'That didn’t work. Try again.');
        return false;
      }
    };
    return {
      problem,
      clearProblem: () => setProblem(null),
      statusOf: (media: Media) => (items.some((item) => item.sourceId === media.sourceId) ? 'added' : 'idle'),
      addLink: add,
      addMedia: (media: Media) => add(media.url),
    };
  }, [items, onChange, problem, slug]);
};

/** What the crew means to watch. Titles come fresh from the server, or not at all. */
export const Watchlist = (props: Props) => {
  const { slug, items, onChange } = props;
  const adder = useWatchAdder(props);
  const search = useSearch(adder);

  const remove = (id: number) => {
    crewApi.removeWatch(slug, id).then(onChange, onChange);
  };

  return (
    <section aria-label="Watchlist" className="mt-8">
      <h2 className="text-sm font-semibold">Watchlist</h2>
      {items.length === 0 && <p className="mt-2 text-sm text-muted">Add something for next time.</p>}
      <div className="mt-2">
        <AddBox id="crew-watchlist" search={search} adder={adder} />
      </div>
      <SearchResults search={search} adder={adder} action="Add" />
      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2">
              {item.media && <Thumb src={item.media.thumbnailUrl} className="w-16 rounded-md" />}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${item.media ? '' : 'text-muted'}`}>{item.media?.title ?? 'Video unavailable'}</span>
                <Byline author={item.media?.author} credit={creditFor(item, props.selfId)} />
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.media?.title ?? 'this video'}`}
                onClick={() => remove(item.id)}
                className="btn btn-ghost btn-sm btn-icon -mr-1.5 text-text"
              >
                <Icon name="close" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
