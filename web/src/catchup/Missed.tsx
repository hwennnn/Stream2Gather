import { useEffect, useState } from 'react';
import { nightOf, plural } from '../recap/words';
import { Thumb } from '../ui/Thumb';
import { catchupApi, type MissedVideo } from './api';

/** Sessions this member wasn't at, with a way into each. Nothing here gives one away. */
export const Missed = ({ slug }: { slug: string }) => {
  const [items, setItems] = useState<MissedVideo[]>([]);

  useEffect(() => {
    let live = true;
    catchupApi.missed(slug).then(
      (reply) => live && setItems(reply.items),
      () => {}, // Nothing to offer is what an empty list says too.
    );
    return () => {
      live = false;
    };
  }, [slug]);

  if (items.length === 0) return null;
  return (
    <section aria-label="Missed" className="mt-8">
      <h2 className="text-sm font-semibold">Saved for you</h2>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {items.map((item) => (
          <li key={item.itemId}>
            <a href={`/r/${encodeURIComponent(slug)}/catchup/${item.itemId}`} aria-label={`Catch up on ${item.media.title}`} className="flex items-center gap-3 py-2">
              <Thumb src={item.media.thumbnailUrl} className="w-20 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.media.title}</span>
                <span className="block text-[13px] text-muted">
                  {nightOf(item.startedAt)}, without you.{item.moments > 0 && ` They left ${plural(item.moments, 'moment')}.`}
                </span>
              </span>
              <span className="btn btn-quiet btn-sm shrink-0">Catch up</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
};
