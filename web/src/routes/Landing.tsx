import { lazy, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAccount } from '../auth/account';
import { AccountMenu } from '../ui/AccountMenu';
import { looksLikeUrl, normalizeUrl } from '../ui/format';
import { SiteHeader, WIDE_COLUMN } from '../ui/Page';
import { Slot } from '../ui/Slot';
import { useTrending } from '../ui/useTrending';
import { badLink, emptyNote, failureFor, linkKinds, type Failure } from './landing/notes';
import { useRecentRoom } from './landing/recent';
import { Footer, inThere, Popular, ReturnRow, RoomPicture } from './landing/Sections';
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
  const { config } = useAccount();
  const kinds = linkKinds(config?.sources);

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
      setError(failureFor(failure, kinds));
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
      setError({ text: badLink(kinds), canStartRoom: true });
      return;
    }
    void start('link', normalizeUrl(text));
  };

  const working = busy !== null;
  const canStartRoom = error?.canStartRoom !== false;

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader>
        <AccountMenu />
      </SiteHeader>

      <main className={`${WIDE_COLUMN} flex flex-1 flex-col pt-10 pb-12 phone:pt-6 land:pt-6`}>
        {recent && (
          <section aria-label="Your last room" className="mb-10 border-y border-line phone:mb-8">
            <ReturnRow href={`/r/${recent.slug}`} title={`Back to ${recent.name}`} note={inThere(recent.members)} people={recent.members} />
          </section>
        )}
        <Slot>
          <CrewRail except={recent?.slug} />
        </Slot>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section aria-labelledby="landing-title">
            <h1 id="landing-title" className="text-4xl leading-10 font-semibold tracking-[-0.02em] text-balance phone:text-[30px] phone:leading-9">
              Save your friends a seat.
            </h1>
            <p className="mt-3 text-[15px] leading-6 text-muted lg:max-w-md">
              Paste a {kinds} link and send the room round. When one of you pauses, everyone waits. No account, nothing to install.
            </p>

            <form onSubmit={submit} className="mt-7 flex gap-2 lg:max-w-md phone:flex-col" noValidate>
              <label htmlFor="link" className="sr-only">
                Paste a video link
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
                placeholder={`Paste a ${kinds} link`}
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
                  {emptyNote(kinds)}
                </p>
              )}
              <button type="button" hidden={!canStartRoom} disabled={working} onClick={() => void start('empty')} className="btn btn-quiet phone:w-full">
                {busy === 'empty' ? 'Opening…' : 'Start an empty room'}
              </button>
            </div>

          </section>

          <RoomPicture media={trending?.[0] ?? null} />
        </div>

        <Popular items={trending} busy={busy} disabled={working} onPick={(media) => void start(media.sourceId, media.url)} />
      </main>

      <Footer />
    </div>
  );
};
