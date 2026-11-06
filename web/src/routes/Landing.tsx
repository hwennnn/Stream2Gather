import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AccountMenu } from '../ui/AccountMenu';
import { looksLikeUrl, normalizeUrl } from '../ui/format';
import { useTrending } from '../ui/useTrending';
import { HeroPreview } from './landing/HeroPreview';
import { BAD_LINK, EMPTY, failureFor, type Failure } from './landing/notes';
import { Footer, HowItWorks, InsideARoom, Trending } from './landing/Sections';
import { loadRoomPage, startRoom } from './router';

export const Landing = () => {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Failure | null>(null);
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
      setError(failureFor(failure));
      setBusy(null);
      // The note sits in the hero, and a trending pick can fail from further down.
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      setError({ text: BAD_LINK, canStartRoom: true });
      return;
    }
    void start('link', normalizeUrl(text));
  };

  const focusInput = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    input.current?.focus({ preventScroll: true });
  };

  const working = busy !== null;
  const canStartRoom = error?.canStartRoom !== false;

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
            <a href="#room" className="btn btn-ghost">Inside a room</a>
            <a href="#how" className="btn btn-ghost">How it works</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <AccountMenu />
            <button type="button" disabled={working || !canStartRoom} onClick={() => void start('empty')} className="btn btn-primary phone:hidden">
              {busy === 'empty' ? 'Opening…' : 'Start a room'}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pt-14 pb-20 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:pt-20 lg:pb-16 phone:pt-8 phone:pb-10 land:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] land:gap-8 land:pt-5 land:pb-10">
          <div className="enter min-w-0">
            <p className="chip border border-line bg-panel/70 land:hidden">
              <span className="size-1.5 rounded-full bg-good" />
              No account needed
            </p>
            <h1 className="mt-5 text-[clamp(1.75rem,8.8vw,3.75rem)] leading-[1.08] font-semibold tracking-tight lg:text-[clamp(3rem,4.7vw,3.4rem)] land:mt-0 land:text-[2.25rem]">
              Watch together,
              <br />
              <span className="text-gradient">at the same moment.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-pretty text-muted phone:text-base land:hidden">
              Paste a YouTube link and send it to your friends. Your room comes with a shared queue and chat beside the video.
            </p>

            <form onSubmit={submit} className="mt-8 max-w-xl land:mt-4" noValidate>
              <label htmlFor="link" className="sr-only">
                YouTube link
              </label>
              <div className="hero-field flex flex-col gap-2.5 rounded-2xl border border-line bg-panel/80 p-2.5 min-[480px]:flex-row min-[480px]:gap-2 min-[480px]:p-2">
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
                  className="h-12 w-full min-w-0 rounded-xl bg-ink/60 px-4 text-base outline-none placeholder:text-muted min-[480px]:h-11 min-[480px]:flex-1 min-[480px]:bg-transparent min-[480px]:px-3"
                />
                <button type="submit" disabled={working} className="btn btn-primary h-12 rounded-xl px-5 text-[15px] min-[480px]:h-11">
                  {busy === 'link' ? 'Opening…' : 'Start watching'}
                </button>
              </div>
            </form>

            <div className="mt-3 min-h-5 text-sm" id="link-note">
              {error && (
                <p role="alert" className="text-warn">
                  {error.text}
                </p>
              )}
              {prompt && <p role="status">{EMPTY}</p>}
              <button
                type="button"
                hidden={!canStartRoom}
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
        <InsideARoom items={trending} />
        <HowItWorks disabled={working} onStart={focusInput} />
      </main>

      <Footer />
    </div>
  );
};
