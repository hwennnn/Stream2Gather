import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/http';
import { navigate } from '../main';
import { normalizeUrl } from '../ui/format';

const copyLink = async (slug: string) => {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/r/${slug}`);
    return true;
  } catch {
    return false; // Some browsers refuse; the room's Share button still works.
  }
};

export const Landing = () => {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (url?: string) => {
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom(url);
      const copied = await copyLink(room.slug);
      navigate(`/r/${room.slug}`, { joined: true, copied });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not reach the server. Try again.');
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void start(link.trim() ? normalizeUrl(link) : undefined);
  };

  return (
    <main className="glow flex min-h-full flex-col">
      <header className="flex items-center gap-2 px-6 py-5 text-[15px] font-semibold tracking-tight">
        <img src="/favicon.svg" alt="" className="size-6" />
        Stream2Gather
      </header>

      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-24">
        <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
          Watch together,
          <br />
          <span className="text-accent">in perfect sync.</span>
        </h1>
        <p className="mt-5 text-lg text-muted">
          Paste a video, share the link, and press play. No sign-up for you or your friends.
        </p>

        <form onSubmit={submit} className="mt-9">
          <label htmlFor="link" className="sr-only">
            YouTube link
          </label>
          <div className="flex gap-2 rounded-2xl border border-line bg-panel p-2 focus-within:border-accent/60">
            <input
              id="link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="Paste a YouTube link"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 cursor-pointer rounded-xl bg-accent px-5 py-2.5 font-semibold text-ink transition hover:brightness-110 disabled:opacity-60"
            >
              {busy ? 'Opening' : 'Start watching'}
            </button>
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-3 text-sm text-warn">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => void start()}
          className="mt-4 w-fit cursor-pointer text-sm text-muted underline-offset-4 hover:text-text hover:underline"
        >
          Or start an empty room
        </button>
      </section>
    </main>
  );
};
