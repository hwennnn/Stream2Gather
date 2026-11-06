import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomPreview } from '../api/http';
import { useAccount } from '../auth/account';
import { Avatar } from './Avatar';
import { formatTime, suggestName } from './format';
import { Thumb } from './Thumb';

type JoinGateProps = {
  preview: RoomPreview | null;
  onJoin: (name: string, changed: boolean) => Promise<void>;
};

const MAX_NAME = 32;
const SHOWN = 5;

const statusLine = (preview: RoomPreview): string => {
  const { playback, nowPlaying } = preview;
  if (!nowPlaying || !playback || playback.status === 'idle') return 'Nothing playing yet';
  const time = formatTime(playback.pos);
  return playback.status === 'paused' ? `Paused at ${time}` : `Playing now · ${time}`;
};

/** The Join click is also the gesture that lets the video start with sound. */
export const JoinGate = ({ preview, onJoin }: JoinGateProps) => {
  const { user } = useAccount();
  const [suggested] = useState(suggestName);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const name = edited ?? user?.name ?? suggested;

  useEffect(() => {
    if (preview && window.matchMedia('(hover: hover)').matches) button.current?.focus();
  }, [preview]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || busy) return;
    const clean = name.trim() || suggested;
    setBusy(true);
    await onJoin(clean, clean !== user?.name);
  };

  const count = preview?.members.length ?? 0;
  const title = preview?.nowPlaying?.title ?? 'Join the watch party';

  return (
    <main className="glow flex min-h-full items-center justify-center p-4 sm:p-6 land:p-3">
      <form
        onSubmit={(event) => void submit(event)}
        className="enter w-full max-w-md rounded-3xl border border-line bg-panel p-5 sm:p-6 land:grid land:max-w-3xl land:grid-cols-2 land:items-center land:gap-5 land:p-4"
      >
        {preview ? (
          <div>
            {preview.nowPlaying ? (
              <Thumb src={preview.nowPlaying.thumbnailUrl} className="w-full rounded-2xl" />
            ) : (
              <div className="glow flex aspect-video items-center justify-center rounded-2xl bg-raised">
                <img src="/favicon.svg" alt="" className="size-10 opacity-90" />
              </div>
            )}
          </div>
        ) : (
          <div aria-hidden="true" className="skeleton aspect-video rounded-2xl" />
        )}

        <div>
          {preview ? (
            <>
              <p className="mt-5 text-sm text-muted land:mt-0">{statusLine(preview)}</p>
              <h1 className="mt-1 line-clamp-2 text-xl leading-snug font-semibold tracking-tight text-balance land:text-[17px]">{title}</h1>
              <div className="mt-3 flex min-h-7 items-center gap-2.5 text-sm text-muted">
                {count > 0 && (
                  <span className="flex -space-x-0.5">
                    {preview.members.slice(0, SHOWN).map((person) => (
                      <Avatar key={person.userId} person={person} />
                    ))}
                  </span>
                )}
                <span className="min-w-0 truncate">
                  {count === 0 && `${preview.name}. Nobody’s here yet.`}
                  {count === 1 && `${preview.members[0]?.name} is in ${preview.name}`}
                  {count > 1 && `${count} people in ${preview.name}`}
                </span>
              </div>
            </>
          ) : (
            <div aria-hidden="true" className="land:mt-0">
              <div className="skeleton mt-5 h-3.5 w-28 rounded land:mt-0" />
              <div className="skeleton mt-3 h-6 w-4/5 rounded" />
              <div className="skeleton mt-3 h-7 w-44 rounded-full" />
            </div>
          )}

          <div className="mt-5 flex items-center gap-2.5 land:mt-3">
            <label htmlFor="join-name" className="shrink-0 text-sm text-muted">
              Joining as
            </label>
            <input
              id="join-name"
              value={name}
              maxLength={MAX_NAME}
              onChange={(event) => setEdited(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="field h-10 min-w-0 flex-1 font-medium"
            />
          </div>

          <button ref={button} type="submit" disabled={!preview || busy} className="btn btn-primary mt-3 h-12 w-full rounded-xl text-base">
            Join
          </button>
        </div>
      </form>
    </main>
  );
};
