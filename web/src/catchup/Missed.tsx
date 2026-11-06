import { useEffect, useState } from 'react';
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
    <section aria-label="Missed" className="mt-6">
      <ul className="divide-y divide-line border-y border-line">
        {items.map((item) => (
          <li key={item.itemId} className="py-2 text-sm">
            <a href={`/r/${encodeURIComponent(slug)}/catchup/${item.itemId}`} className="text-link">
              You missed this. Catch up.
            </a>
            <p className="mt-0.5 truncate text-[13px] text-muted">{item.media.title}</p>
          </li>
        ))}
      </ul>
    </section>
  );
};
