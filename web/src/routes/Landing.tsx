import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';
import { AccountMenu } from '../ui/AccountMenu';
import { looksLikeUrl, normalizeUrl } from '../ui/format';
import { useTrending } from '../ui/useTrending';
import { HeroPreview } from './landing/HeroPreview';
import { Closing, Features, Footer, HowItWorks, Trending } from './landing/Sections';
import { loadRoomPage, startRoom } from './router';

const BAD_LINK = 'That isn’t a YouTube link. Paste one, or start an empty room and search there.';
const EMPTY = 'Paste a link, or start an empty room.';

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

  const focusInput = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    input.current?.focus({ preventScroll: true });
  };

  const working = busy !== null;

  return (
    <div className="landing min-h-full">
      <header className="sticky top-0 z-20 border-b border-transparent bg-ink/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2.5 px-6">
          <a href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="size-7" />
            Stream2Gather
          </a>
          <nav aria-label="Page" className="ml-8 hidden items-center gap-1 md:flex">
            <a href="#trending" className="btn btn-ghost">Trending</a>
            <a href="#how" className="btn btn-ghost">How it works</a>
            <a href="#features" className="btn btn-ghost">Features</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <AccountMenu />
            <button type="button" disabled={working} onClick={() => void start('empty')} className="btn btn-primary phone:hidden">
              {busy === 'empty' ? 'Opening…' : 'Start a room'}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pt-14 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:pt-20 lg:pb-28 phone:pt-8 phone:pb-12">
          <div className="enter min-w-0">
            <p className="chip border border-line bg-panel/70">
              <span className="size-1.5 rounded-full bg-good" />
              No account needed
            </p>
            <h1 className="mt-5 text-[2.9rem] leading-[1.04] font-semibold tracking-tight text-balance sm:text-[4rem]">
              Watch together,
              <br />
              <span className="text-gradient">in perfect sync.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-pretty text-muted phone:text-base">
              Paste a video and send the link. Everyone lands on the same moment, with a shared queue and chat beside it.
            </p>

            <form onSubmit={submit} className="mt-8 max-w-xl" noValidate>
              <label htmlFor="link" className="sr-only">
                YouTube link
              </label>
              <div className="hero-field flex flex-col gap-2 rounded-2xl border border-line bg-panel/80 p-2 min-[480px]:flex-row">
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
              <button
                type="button"
                disabled={working}
                onClick={() => void start('empty')}
                className={`cursor-pointer text-muted underline-offset-4 hover:text-text hover:underline disabled:opacity-60 ${error || prompt ? 'mt-2 underline' : ''}`}
              >
                {busy === 'empty' ? 'Opening…' : 'Or start an empty room and search there'}
              </button>
            </div>
          </div>

          <HeroPreview thumbnail={trending?.[0]?.thumbnailUrl ?? ''} title={trending?.[0]?.title ?? 'Tonight’s movie'} />
        </section>

        <Trending items={trending} busy={busy} disabled={working} onPick={(media) => void start(media.sourceId, media.url)} />
        <HowItWorks />
        <Features />
        <Closing disabled={working} onStart={focusInput} />
      </main>

      <Footer />
    </div>
  );
};
