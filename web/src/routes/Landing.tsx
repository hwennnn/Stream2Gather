import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Media } from '../api/http';
import { AccountMenu } from '../ui/AccountMenu';
import { looksLikeUrl, normalizeUrl } from '../ui/format';
import { Thumb } from '../ui/Thumb';
import { useTrending } from '../ui/useTrending';
import { loadRoomPage, startRoom } from './router';

const BAD_LINK = 'That isn’t a YouTube link. Paste one, or start an empty room and search there.';
const EMPTY = 'Paste a link, or start an empty room.';
const PICKS = 4;

const messageFor = (failure: unknown): string => {
  if (!(failure instanceof ApiError)) return 'Could not reach the server. Try again.';
  return /not supported/i.test(failure.message) ? BAD_LINK : failure.message;
};

export const Landing = () => {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trending = useTrending();

  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.current?.focus();
    // Warm the room's code while the visitor reads, so joining is instant.
    const idle = window.requestIdleCallback ?? ((work: () => void) => window.setTimeout(work, 400));
    idle(() => void loadRoomPage());
  }, []);

  const start = async (key: string, url?: string) => {
    setBusy(key);
    setError(null);
    setPrompt(false);
    try {
      await startRoom(url);
    } catch (failure) {
      setError(messageFor(failure));
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = link.trim();
    if (!text) {
      setError(null);
      setPrompt(true);
      input.current?.focus();
      return;
    }
    if (!looksLikeUrl(text)) {
      setPrompt(false);
      setError(BAD_LINK);
      return;
    }
    void start('link', normalizeUrl(text));
  };

  const working = busy !== null;

  return (
    <main className="glow flex min-h-full flex-col">
      <header className="flex items-center gap-2 px-6 py-5 text-[15px] font-semibold tracking-tight">
        <img src="/favicon.svg" alt="" className="size-6" />
        Stream2Gather
        <div className="ml-auto">
          <AccountMenu />
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pt-4 pb-16">
        <h1 className="text-[2.75rem] leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
          Watch together,
          <br />
          <span className="text-accent">in perfect sync.</span>
        </h1>
        <p className="mt-5 text-lg text-pretty text-muted phone:text-base">
          Paste a video, share the link, and press play. No sign-up for you or your friends.
        </p>

        <form onSubmit={submit} className="mt-8" noValidate>
          <label htmlFor="link" className="sr-only">
            YouTube link
          </label>
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-2 transition-colors focus-within:border-white/25 min-[480px]:flex-row">
            <input
              ref={input}
              id="link"
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
                setError(null);
                setPrompt(false);
              }}
              placeholder="Paste a YouTube link"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-invalid={error !== null}
              aria-describedby={error || prompt ? 'link-note' : undefined}
              className="h-11 min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted"
            />
            <button type="submit" disabled={working} className="btn btn-primary h-11 rounded-xl px-5 text-[15px]">
              {busy === 'link' ? 'Opening…' : 'Start watching'}
            </button>
          </div>
        </form>

        <div className="mt-3 min-h-5 text-sm" id="link-note">
          {error && (
            <p role="alert" className="text-warn">
              {error}
            </p>
          )}
          {prompt && <p role="status">{EMPTY}</p>}
          {!error && !prompt && (
            <button
              type="button"
              disabled={working}
              onClick={() => void start('empty')}
              className="cursor-pointer text-muted underline-offset-4 hover:text-text hover:underline disabled:opacity-60"
            >
              {busy === 'empty' ? 'Opening…' : 'Or start an empty room'}
            </button>
          )}
          {(error || prompt) && (
            <button
              type="button"
              disabled={working}
              onClick={() => void start('empty')}
              className="mt-2 cursor-pointer text-muted underline underline-offset-4 hover:text-text disabled:opacity-60"
            >
              Start an empty room
            </button>
          )}
        </div>

        <Picks items={trending} busy={busy} disabled={working} onPick={(media) => void start(media.sourceId, media.url)} />
      </section>
    </main>
  );
};

type PicksProps = { items: Media[] | null; busy: string | null; disabled: boolean; onPick: (media: Media) => void };

const Picks = ({ items, busy, disabled, onPick }: PicksProps) => {
  if (items?.length === 0) return null;
  return (
    <section aria-labelledby="picks" className="mt-10 phone:mt-8">
      <h2 id="picks" className="text-sm font-medium text-muted">
        Or pick something
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items
          ? items.slice(0, PICKS).map((media) => (
              <li key={media.sourceId} className="min-w-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(media)}
                  className="group block w-full cursor-pointer text-left disabled:cursor-default"
                >
                  <span className="relative block overflow-hidden rounded-xl ring-1 ring-line">
                    <Thumb src={media.thumbnailUrl} className="w-full transition duration-200 group-hover:scale-[1.03] group-hover:brightness-110" />
                    {busy === media.sourceId && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <span className="spinner" />
                      </span>
                    )}
                  </span>
                  <span className="mt-2 line-clamp-2 text-[13px] leading-snug text-muted transition-colors group-hover:text-text">
                    {media.title}
                  </span>
                </button>
              </li>
            ))
          : Array.from({ length: PICKS }, (_, index) => (
              <li key={index} aria-hidden="true">
                <div className="skeleton aspect-video rounded-xl" />
                <div className="skeleton mt-2 h-3 w-4/5 rounded" />
              </li>
            ))}
      </ul>
    </section>
  );
};
