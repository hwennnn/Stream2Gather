import { lazy, useEffect, useRef, useState, type FormEvent } from 'react';
import { AccountMenu } from '../ui/AccountMenu';
import { looksLikeUrl, normalizeUrl } from '../ui/format';
import { Slot } from '../ui/Slot';
import { useTrending } from '../ui/useTrending';
import { Wordmark } from '../ui/Wordmark';
import { BAD_LINK, EMPTY, failureFor, type Failure } from './landing/notes';
import { useRecentRoom } from './landing/recent';
import { Footer, Popular, RecentRoomRow, RoomPicture } from './landing/Sections';
import { loadRoomPage, startRoom } from './router';

const CrewRail = lazy(() => import('../crew/CrewRail'));

export const Landing = () => {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [prompt, setPrompt] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trending = useTrending();
  const recent = useRecentRoom();

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
      // The note sits by the field, and on a phone a trending pick can fail from below it.
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

  const working = busy !== null;
  const canStartRoom = error?.canStartRoom !== false;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1160px] items-center justify-between px-6 phone:px-4">
          <a href="/" aria-label="Stream2Gather home">
            <Wordmark />
          </a>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1160px] flex-1 px-6 pt-14 pb-12 phone:px-4 phone:pt-6 land:pt-6">
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section aria-labelledby="landing-title">
            <h1 id="landing-title" className="text-[44px] leading-[48px] font-semibold tracking-[-0.025em] text-balance phone:text-[32px] phone:leading-9">
              A room for watching YouTube with friends.
            </h1>
            <p className="mt-4 text-[15px] lg:max-w-md leading-6 text-muted">
              Paste a link and send the room to your friends. Everyone follows one player, so a pause, skip or seek happens for the whole room.
            </p>

            <form onSubmit={submit} className="mt-7 flex gap-2 lg:max-w-md phone:flex-col" noValidate>
              <label htmlFor="link" className="sr-only">
                YouTube link
              </label>
              <input
                ref={input}
                id="link"
                value={link}
                onChange={(event) => {
                  setLink(event.target.value);
                  setError(null);
                  setPrompt(false);
                }}
                placeholder="youtube.com/watch?v=…"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                aria-invalid={error !== null}
                aria-describedby={error || prompt ? 'link-note' : undefined}
                className="field min-w-0 flex-1 phone:flex-none"
              />
              <button type="submit" disabled={working} className="btn btn-primary">
                {busy === 'link' ? 'Opening…' : 'Start room'}
              </button>
            </form>

            <div className="mt-2 text-[13px] lg:max-w-md" id="link-note">
              {error && (
                <p role="alert" className="mb-2 text-bad">
                  {error.text}
                </p>
              )}
              {prompt && (
                <p role="status" className="mb-2">
                  {EMPTY}
                </p>
              )}
              <button type="button" hidden={!canStartRoom} disabled={working} onClick={() => void start('empty')} className="btn btn-quiet phone:w-full">
                {busy === 'empty' ? 'Opening…' : 'Start an empty room'}
              </button>
            </div>

            {recent && <RecentRoomRow room={recent} />}
          </section>

          <RoomPicture media={trending?.[0] ?? null} />
        </div>

        <Slot>
          <CrewRail />
        </Slot>
        <Popular items={trending} busy={busy} disabled={working} onPick={(media) => void start(media.sourceId, media.url)} />
      </main>

      <Footer />
    </div>
  );
};
