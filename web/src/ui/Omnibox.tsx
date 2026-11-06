import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Media } from '../api/http';
import type { RoomSession } from '../room/session';
import { formatTime, looksLikeUrl, normalizeUrl } from './format';

type Props = { session: RoomSession; autoFocus?: boolean };

export const Omnibox = ({ session, autoFocus }: Props) => {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [results, setResults] = useState<Media[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, []);

  const add = (url: string, playNow = false) => {
    session.send('queue.add', { url, playNow });
    setValue('');
    setResults(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    if (looksLikeUrl(text)) {
      add(normalizeUrl(text));
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      setResults((await api.search(text)).items);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'Search is unavailable right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-left">
      <form onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="omnibox">
          Add a video
        </label>
        <input
          id="omnibox"
          ref={input}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={busy ? 'Searching' : 'Paste a link or search'}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-xl border border-line bg-raised px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent/60"
        />
      </form>

      {problem && <p className="mt-2 text-sm text-warn">{problem}</p>}

      {results && (
        <ul className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-line bg-panel">
          {results.length === 0 && <li className="p-4 text-sm text-muted">No videos found.</li>}
          {results.map((media) => (
            <MediaRow key={media.sourceId} media={media} onAdd={() => add(media.url)} onPlay={() => add(media.url, true)} />
          ))}
        </ul>
      )}
    </div>
  );
};

type RowProps = { media: Media; onAdd: () => void; onPlay: () => void };

export const MediaRow = ({ media, onAdd, onPlay }: RowProps) => (
  <li className="flex items-center gap-3 p-2 hover:bg-raised">
    <img src={media.thumbnailUrl} alt="" loading="lazy" className="aspect-video w-24 shrink-0 rounded-md bg-raised object-cover" />
    <div className="min-w-0 flex-1">
      <p className="line-clamp-2 text-sm leading-snug font-medium">{media.title}</p>
      <p className="truncate text-xs text-muted">
        {media.author}
        {media.durationMs > 0 ? ` · ${formatTime(media.durationMs / 1000)}` : ''}
      </p>
    </div>
    <div className="flex shrink-0 flex-col gap-1">
      <button type="button" onClick={onPlay} className="cursor-pointer rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-ink">
        Play
      </button>
      <button type="button" onClick={onAdd} className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs hover:bg-ink">
        Queue
      </button>
    </div>
  </li>
);
