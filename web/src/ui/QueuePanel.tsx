import { useEffect, useState } from 'react';
import { api, type Media } from '../api/http';
import type { RoomSession, RoomView } from '../room/session';
import { formatTime } from './format';
import { MediaRow, Omnibox } from './Omnibox';

type Props = { session: RoomSession; view: RoomView };

export const QueuePanel = ({ session, view }: Props) => {
  const [trending, setTrending] = useState<Media[]>([]);
  const upcoming = view.queue.slice(1);

  useEffect(() => {
    api.trending().then(({ items }) => setTrending(items), () => setTrending([]));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Omnibox session={session} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {upcoming.length > 0 && (
          <ol>
            {upcoming.map((item, index) => (
              <li key={item.id} className="group flex items-center gap-3 px-3 py-2 hover:bg-raised">
                <span className="w-4 text-center text-xs text-muted">{index + 1}</span>
                <img src={item.thumbnailUrl} alt="" loading="lazy" className="aspect-video w-20 shrink-0 rounded-md bg-raised object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted">
                    {item.addedByName}
                    {item.durationMs > 0 ? ` · ${formatTime(item.durationMs / 1000)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => session.send('queue.play', { target: item.id })}
                    className="cursor-pointer rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-ink"
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    onClick={() => session.send('queue.remove', { target: item.id })}
                    className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {upcoming.length === 0 && (
          <>
            <p className="px-4 pt-1 pb-2 text-xs font-medium tracking-wide text-muted uppercase">Trending</p>
            <ul>
              {trending.map((media) => (
                <MediaRow
                  key={media.sourceId}
                  media={media}
                  onAdd={() => session.send('queue.add', { url: media.url })}
                  onPlay={() => session.send('queue.add', { url: media.url, playNow: true })}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};
