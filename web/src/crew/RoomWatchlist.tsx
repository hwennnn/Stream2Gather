import { useEffect, useState } from 'react';
import type { RoomSession, RoomView } from '../room/session';
import { MediaRow } from '../ui/Omnibox';
import { canQueue } from '../ui/rules';
import { useAdder } from '../ui/useAdder';
import { crewApi, type WatchItem } from './api';

type Props = { session: RoomSession; view: RoomView };

/** The crew's list, inside the room. Its own group, so it never mixes with YouTube's results. */
export default function RoomWatchlist({ session, view }: Props) {
  const adder = useAdder(session, view);
  const [items, setItems] = useState<WatchItem[]>([]);
  const { slug } = session;

  useEffect(() => {
    const load = () => {
      crewApi.watchlist(slug).then(
        (list) => setItems(list.items),
        () => {}, // Search and the queue carry on without it.
      );
    };
    load();
    return session.onCrew((changed) => {
      if (changed === 'watchlist') load();
    });
  }, [session, slug]);

  const videos = items.flatMap((item) => (item.media ? [item.media] : []));
  if (videos.length === 0 || !canQueue(view)) return null;

  return (
    <section aria-label="Your watchlist" className="mt-3 text-left">
      <h3 className="py-1.5 text-[13px] font-semibold">Your watchlist</h3>
      <ul>
        {videos.map((media) => (
          <MediaRow key={media.sourceId} media={media} status={adder.statusOf(media)} onAdd={adder.addMedia} />
        ))}
      </ul>
    </section>
  );
}
