import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, type Media } from '../api/http';
import { useAccount } from '../auth/account';
import type { QueueMode } from '../room/session';
import { formatTime, looksLikeUrl, normalizeUrl } from './format';
import { Icon } from './Icon';
import { addPrompt } from './sources';
import { Thumb } from './Thumb';
import type { Adder, AddStatus } from './useAdder';

const isMac = () => /mac|iphone|ipad/i.test(navigator.platform);

export type Search = {
  value: string;
  setValue: (value: string) => void;
  searching: boolean;
  /** The query being shown, or null while search is closed. */
  query: string | null;
  results: Media[] | null;
  problem: string | null;
  close: () => void;
  submit: () => Promise<void>;
  busy: boolean;
};

/** The box and its results live apart in the layout, so their state lives here. */
export const useSearch = (adder: Adder): Search => {
  const [value, setValue] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<Media[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);

  const close = useCallback(() => {
    latest.current += 1;
    setQuery(null);
    setResults(null);
    setSearching(false);
    setProblem(null);
    setValue('');
  }, []);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy) return;
    if (looksLikeUrl(text)) {
      setBusy(true);
      const added = await adder.addLink(normalizeUrl(text));
      setBusy(false);
      if (added) close(); // A rejected link stays put so it can be fixed.
      return;
    }

    const run = (latest.current += 1);
    adder.clearProblem();
    setProblem(null);
    setQuery(text);
    setResults(null);
    setSearching(true);
    try {
      const { items } = await api.search(text);
      if (run === latest.current) setResults(items);
    } catch (error) {
      if (run !== latest.current) return;
      setProblem(error instanceof ApiError ? error.message : 'Search isn’t available right now. Paste a link instead.');
      setResults([]);
    } finally {
      if (run === latest.current) setSearching(false);
    }
  };

  return { value, setValue, searching, query, results, problem, close, submit, busy };
};

type AddBoxProps = { id: string; search: Search; adder: Adder; large?: boolean };

export const AddBox = ({ id, search, adder, large }: AddBoxProps) => {
  const { config } = useAccount();
  const { close } = search;
  const open = search.query !== null;
  const errorId = `${id}-error`;

  // Esc closes search wherever focus has wandered to in the results.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search.submit();
  };

  const showClear = search.value.length > 0 || open;

  return (
    <div className="text-left">
      <form onSubmit={submit} className="relative">
        <label className="sr-only" htmlFor={id}>
          Add a video
        </label>
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">
          {search.busy || search.searching ? <span className="spinner" /> : <Icon name="search" />}
        </span>
        <input
          id={id}
          value={search.value}
          onChange={(event) => {
            search.setValue(event.target.value);
            adder.clearProblem();
          }}
          placeholder={large ? addPrompt(config?.sources ?? []) : 'Paste a link or search'}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-invalid={adder.problem !== null}
          aria-describedby={adder.problem ? errorId : undefined}
          className={`field pr-11 pl-10 ${large ? 'h-12' : ''}`}
        />
        {showClear ? (
          <button
            type="button"
            aria-label={open ? 'Close search' : 'Clear'}
            onClick={() => {
              search.close();
              adder.clearProblem();
            }}
            className="btn btn-ghost btn-icon btn-sm absolute top-1/2 right-2 -translate-y-1/2"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute inset-y-0 right-3 my-auto hidden h-fit rounded-md bg-white/[0.06] px-1.5 py-0.5 font-sans text-[11px] text-muted [@media(hover:hover)]:block">
            {isMac() ? '⌘K' : 'Ctrl K'}
          </kbd>
        )}
      </form>
      {adder.problem && (
        <p id={errorId} role="alert" className="mt-2 text-[13px] text-warn">
          {adder.problem}
        </p>
      )}
    </div>
  );
};

type ResultsProps = { search: Search; adder: Adder };

/** Extra is a labelled group of its own beside the results, which YouTube's rules keep unmixed. */
export const SearchResults = ({ extra, ...props }: ResultsProps & { extra?: ReactNode }) => (
  <>
    {props.search.query !== null && extra}
    <Results {...props} />
  </>
);

const Results = ({ search, adder }: ResultsProps) => {
  if (search.query === null) return null;
  return (
    <section aria-label="Search results" className="enter">
      <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-1.5">
        <h3 className="min-w-0 truncate text-[13px] font-semibold">Results for “{search.query}”</h3>
      </div>
      {search.searching && <MediaSkeleton count={5} />}
      {search.problem && <p className="px-3 py-3 text-sm text-warn">{search.problem}</p>}
      {!search.searching && !search.problem && search.results?.length === 0 && (
        <p className="px-3 py-3 text-sm text-muted">Nothing found for “{search.query}”. Try other words, or paste a link.</p>
      )}
      {search.results && search.results.length > 0 && (
        <ul className="px-1">
          {search.results.map((media) => (
            <MediaRow key={media.sourceId} media={media} status={adder.statusOf(media)} onAdd={(mode) => void adder.addMedia(media, mode)} />
          ))}
        </ul>
      )}
    </section>
  );
};

export const MediaSkeleton = ({ count }: { count: number }) => (
  <ul aria-hidden="true" className="px-1">
    {Array.from({ length: count }, (_, index) => (
      <li key={index} className="flex gap-3 p-2">
        <span className="skeleton aspect-video w-28 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1 space-y-2 pt-1">
          <span className="skeleton block h-3 w-full rounded" />
          <span className="skeleton block h-3 w-2/3 rounded" />
        </span>
      </li>
    ))}
  </ul>
);

const STATUS_TEXT: ReadonlyMap<AddStatus, string> = new Map([
  ['adding', 'Adding…'],
  ['added', 'Added ✓'],
  ['queued', 'Already queued'],
  ['playing', 'Playing now'],
]);

const ACTIONS: { mode: QueueMode; label: string }[] = [
  { mode: 'now', label: 'Play now' },
  { mode: 'next', label: 'Play next' },
  { mode: 'end', label: 'Queue' },
];

type RowProps = { media: Media; status: AddStatus; onAdd: (mode: QueueMode) => void };

/** One video you could add. Hover shows the actions; touch taps to queue, ⋯ for the rest. */
export const MediaRow = ({ media, status, onAdd }: RowProps) => {
  const [tray, setTray] = useState(false);
  const label = STATUS_TEXT.get(status);
  const meta = [media.author, media.durationMs > 0 ? formatTime(media.durationMs / 1000) : ''].filter(Boolean).join(' · ');

  return (
    <li className="row relative rounded-xl p-2 transition-colors hover:bg-white/[0.04]">
      {!label && (
        <button type="button" aria-label={`Queue ${media.title}`} onClick={() => onAdd('end')} className="row-tap absolute inset-0 rounded-xl" />
      )}
      <div className="flex items-center gap-3">
        <Thumb src={media.thumbnailUrl} className="w-28 rounded-lg land:w-20" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] leading-snug font-medium">{media.title}</p>
          <div className="relative mt-1 min-h-[26px]">
            {label ? (
              <p className="flex justify-between gap-2 text-xs leading-[26px] text-muted">
                <span className="min-w-0 truncate">{meta}</span>
                <span className={`shrink-0 font-medium ${status === 'added' ? 'text-good' : ''}`}>{label}</span>
              </p>
            ) : (
              <p className="row-meta truncate text-xs leading-[26px] text-muted transition-opacity">{meta}</p>
            )}
            {!label && (
              <div className="row-actions absolute inset-0 flex items-center gap-1 transition-opacity">
                {ACTIONS.map(({ mode, label: text }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={`${text}: ${media.title}`}
                    onClick={() => onAdd(mode)}
                    className={`btn btn-sm ${mode === 'now' ? 'btn-primary' : 'btn-quiet'}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {!label && (
          <button
            type="button"
            aria-label={`More for ${media.title}`}
            aria-expanded={tray}
            onClick={() => setTray(!tray)}
            className="row-more btn btn-ghost btn-icon relative"
          >
            <Icon name="more" className="mx-auto size-5" />
          </button>
        )}
      </div>
      {tray && !label && (
        <div className="relative mt-2 flex gap-2">
          {ACTIONS.map(({ mode, label: text }) => (
            <button key={mode} type="button" onClick={() => onAdd(mode)} className={`btn flex-1 ${mode === 'now' ? 'btn-primary' : 'btn-quiet'}`}>
              {text}
            </button>
          ))}
        </div>
      )}
    </li>
  );
};
