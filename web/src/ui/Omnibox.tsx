import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, type Media } from '../api/http';
import { useAccount } from '../auth/account';
import type { QueueMode } from '../room/session';
import { formatTime, looksLikeUrl, normalizeUrl } from './format';
import { Icon, type IconName } from './Icon';
import { addPrompt } from './sources';
import { Thumb } from './Thumb';
import type { Adder, AddStatus } from './useAdder';
import { viewerRegion } from './region';


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
      const { items } = await api.search(text, viewerRegion(navigator.language));
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
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-dim">
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
          className="field pr-11 pl-9"
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
        ) : null}
      </form>
      {adder.problem && (
        <p id={errorId} role="alert" className="mt-2 text-[13px] text-bad">
          {adder.problem}
        </p>
      )}
    </div>
  );
};

type ResultsProps = {
  search: Search;
  adder: Adder;
  /** Replaces the ways to play, where results go somewhere other than the queue. */
  action?: string;
};

/** Extra is a labelled group of its own beside the results, which YouTube's rules keep unmixed. */
export const SearchResults = ({ extra, ...props }: ResultsProps & { extra?: ReactNode }) => (
  <>
    {props.search.query !== null && extra}
    <Results {...props} />
  </>
);

const Results = ({ search, adder, action }: ResultsProps) => {
  if (search.query === null) return null;
  return (
    <section aria-label="Search results" className="enter">
      <h3 className="truncate pb-1.5 text-[13px] font-semibold">Results for “{search.query}”</h3>
      {search.searching && <MediaSkeleton count={5} />}
      {search.problem && <p className="py-3 text-bad">{search.problem}</p>}
      {!search.searching && !search.problem && search.results?.length === 0 && (
        <p className="py-3 text-muted">Nothing found for “{search.query}”. Try other words, or paste a link.</p>
      )}
      {search.results && search.results.length > 0 && (
        <ul>
          {search.results.map((media) => (
            <MediaRow key={media.sourceId} media={media} status={adder.statusOf(media)} action={action} onAdd={(mode) => void adder.addMedia(media, mode)} />
          ))}
        </ul>
      )}
    </section>
  );
};

export const MediaSkeleton = ({ count }: { count: number }) => (
  <ul aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <li key={index} className="flex gap-3 py-2">
        <span className="skeleton aspect-video w-20 shrink-0 rounded-md" />
        <span className="min-w-0 flex-1 space-y-2 pt-1">
          <span className="skeleton block h-3 w-full rounded" />
          <span className="skeleton block h-3 w-2/3 rounded" />
        </span>
      </li>
    ))}
  </ul>
);

/** Keeps the channel and the time in view beside a row's buttons. */
export const actionRoom = (count: number) => ({ '--acts': `${count * 32 + 4}px` }) as CSSProperties;

const STATUS_TEXT: ReadonlyMap<AddStatus, string> = new Map([
  ['adding', 'Adding…'],
  ['added', 'Added ✓'],
  ['queued', 'Queued'],
  ['playing', 'Playing now'],
]);

const ACTIONS: { mode: QueueMode; label: string; icon: IconName }[] = [
  { mode: 'now', label: 'Play now', icon: 'play' },
  { mode: 'next', label: 'Play next', icon: 'next' },
  { mode: 'end', label: 'Queue', icon: 'plus' },
];

type RowProps = { media: Media; status: AddStatus; action?: string; onAdd: (mode: QueueMode) => void };

/** One video you could add. Hover shows the actions; touch taps to queue, ⋯ for the rest. */
export const MediaRow = ({ media, status, action, onAdd }: RowProps) => {
  const actions = action ? ACTIONS.filter(({ mode }) => mode === 'end').map((one) => ({ ...one, label: action })) : ACTIONS;
  const [tray, setTray] = useState(false);
  const label = STATUS_TEXT.get(status);
  const duration = media.durationMs > 0 && <span className="fig shrink-0 text-dim">{formatTime(media.durationMs / 1000)}</span>;

  return (
    <li className="row relative py-2">
      {!label && (
        <button type="button" aria-label={`${action ?? 'Queue'} ${media.title}`} onClick={() => onAdd('end')} className="row-tap absolute inset-0" />
      )}
      <div className="flex items-center gap-3">
        <Thumb src={media.thumbnailUrl} className="w-20 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] leading-[18px] font-medium">{media.title}</p>
          <div style={actionRoom(actions.length)} className="relative min-h-[26px]">
            {label ? (
              <p className="flex justify-between gap-2 text-xs leading-[26px] text-muted">
                <span className="flex min-w-0 gap-2">
                  <span className="min-w-0 truncate">{media.author}</span>
                  {duration}
                </span>
                <span className={`shrink-0 font-medium ${status === 'added' ? 'text-good' : ''}`}>{label}</span>
              </p>
            ) : (
              <p className="row-meta flex gap-2 text-xs leading-[26px] text-muted transition-opacity">
                <span className="min-w-0 truncate">{media.author}</span>
                {duration}
              </p>
            )}
            {!label && (
              <div className="row-actions">
                {actions.map(({ mode, label: text, icon }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={`${text}: ${media.title}`}
                    title={text}
                    onClick={() => onAdd(mode)}
                    className={`btn btn-sm btn-icon ${mode === 'now' ? 'btn-primary' : 'btn-quiet'}`}
                  >
                    <Icon name={icon} className="size-3.5" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {!label && !action && (
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
      {media.refused && <p className="mt-1 text-xs text-warn">Often won’t play here. YouTube has refused it for other viewers.</p>}
      {media.regionBlocked && !media.refused && <p className="mt-1 text-xs text-warn">May be blocked where you are.</p>}
      {tray && !label && (
        <div className="row-tray">
          {ACTIONS.map(({ mode, label: text }) => (
            <button key={mode} type="button" onClick={() => onAdd(mode)} className={`btn ${mode === 'now' ? 'btn-primary' : 'btn-quiet'}`}>
              {text}
            </button>
          ))}
        </div>
      )}
    </li>
  );
};
