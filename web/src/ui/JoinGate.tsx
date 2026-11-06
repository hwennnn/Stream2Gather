import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomPreview } from '../api/http';
import { useAccount } from '../auth/account';
import { Avatar } from './Avatar';
import { formatTime, suggestName } from './format';
import { Page } from './Page';
import { firstName, seatHues } from './people';
import { Thumb } from './Thumb';

type JoinGateProps = {
  preview: RoomPreview | null;
  onJoin: (name: string, changed: boolean) => Promise<void>;
};

const MAX_NAME = 32;
const SHOWN = 4;
/** A room you arrive at early still has places in it. */
const MIN_EMPTY = 2;

const WhereItIs = ({ preview }: { preview: RoomPreview }) => {
  const { playback, nowPlaying } = preview;
  if (!nowPlaying || !playback || playback.status === 'idle') return null;
  const time = <span className="fig text-[13px]">{formatTime(playback.pos)}</span>;
  return <p className="mt-0.5 text-[13px] text-muted">{playback.status === 'paused' ? <>Paused at {time}</> : <>{time} in</>}</p>;
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

  const others = preview?.members ?? [];
  seatHues(others.map((person) => person.userId));
  const extra = others.length - SHOWN;
  const inviter = others.find((person) => person.role === 'host') ?? others[0];
  const empties = Math.max(0, MIN_EMPTY - others.length);

  return (
    <Page>
      <form onSubmit={(event) => void submit(event)} className="enter land:grid land:grid-cols-2 land:items-start land:gap-6">
        {preview ? (
          preview.nowPlaying && <Thumb src={preview.nowPlaying.thumbnailUrl} className="mb-5 w-full rounded-lg land:mb-0" />
        ) : (
          <div aria-hidden="true" className="skeleton mb-5 aspect-video rounded-lg land:mb-0" />
        )}

        <div>
          {preview ? (
            <>
              <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em] text-balance">{inviter ? `${firstName(inviter.name)} saved you a seat` : preview.name}</h1>
              {inviter ? (
                <p className="mt-1 line-clamp-2 text-muted">{preview.nowPlaying ? `${preview.name}, watching ${preview.nowPlaying.title}` : preview.name}</p>
              ) : (
                <p className="mt-1 text-muted">You’re first in. Friends with the link will sit down next to you.</p>
              )}
              <WhereItIs preview={preview} />
            </>
          ) : (
            <div aria-hidden="true">
              <div className="skeleton h-7 w-4/5 rounded" />
              <div className="skeleton mt-2 h-4 w-3/5 rounded" />
            </div>
          )}

          <ul aria-label="In the room" data-gate="true" className="seats mt-6">
            {others.slice(0, SHOWN).map((person) => (
              <li key={person.userId} className="seat">
                <span className="seat-disc">
                  <Avatar person={person} labelled={false} className="size-full text-[13px]" />
                </span>
                <span className="seat-name">{firstName(person.name)}</span>
              </li>
            ))}
            {extra > 0 && (
              <li className="seat">
                <span className="seat-more">+{extra}</span>
              </li>
            )}
            <li className="seat seat-you">
              <span className="seat-empty" />
              <span className="seat-name">{name.trim() || suggested}</span>
            </li>
            {Array.from({ length: empties }, (_, index) => (
              <li key={index} aria-hidden="true" className="seat">
                <span className="seat-empty" />
              </li>
            ))}
          </ul>

          <label htmlFor="join-name" className="mt-6 block text-[13px] text-muted">
            Your name
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="join-name"
              value={name}
              maxLength={MAX_NAME}
              onChange={(event) => setEdited(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="field min-w-0 flex-1"
            />
            <button ref={button} type="submit" disabled={!preview || busy} className="btn btn-primary">
              Join
            </button>
          </div>
        </div>
      </form>
    </Page>
  );
};
