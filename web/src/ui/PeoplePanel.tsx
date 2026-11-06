import { lazy, useEffect, useRef, useState, type FormEvent } from 'react';
import { account } from '../auth/account';
import type { RoomSession, RoomView } from '../room/session';
import { Avatar } from './Avatar';
import { isHost, isLocked, isOffline, rosterFor } from './rules';
import { Slot } from './Slot';
import { toastError } from './Toasts';

const VoiceSettings = lazy(() => import('../voice/VoiceButton').then(({ VoiceSettingsSlot }) => ({ default: VoiceSettingsSlot })));

type Props = { session: RoomSession; view: RoomView; onToast: (text: string) => void };

const STATUS_TEXT = new Map([
  ['buffering', 'Catching up'],
  ['stalled', 'Watching an ad'],
  ['correcting', 'Catching up'],
  ['unavailable', 'Can’t play this video'],
]);

const VOICE_TEXT = new Map([
  ['listening', 'Listening'],
  ['muted', 'Muted'],
  ['live', 'Mic on'],
]);

const MAX_NAME = 32;

export const PeoplePanel = ({ session, view, onToast }: Props) => {
  const [editing, setEditing] = useState(false);

  const inCall = view.members.some((person) => person.userId === view.self?.userId && person.voice);

  return (
    <div className="flex h-full flex-col">
      <ul className="rail-scroll min-h-0 flex-1 py-1">
        {rosterFor(view).map((person) => {
          const own = person.userId === view.self?.userId;
          const status = STATUS_TEXT.get(view.viewerStates[person.userId] ?? '');
          const speaking = view.speaking.includes(person.userId);
          const voice = speaking ? 'Speaking' : VOICE_TEXT.get(person.voice ?? '');
          const badges = [person.role === 'host' ? 'Host' : undefined, person.member ? 'Crew' : undefined, voice].filter(Boolean);

          if (own && editing) {
            return (
              <li key={person.userId} className="row py-2.5">
                <NameEditor session={session} name={view.self?.name ?? person.name} onDone={() => setEditing(false)} />
              </li>
            );
          }
          return (
            <li key={person.userId} data-speaking={speaking} className="flex min-h-11 items-center gap-2.5">
              <Avatar person={person} className="size-7 text-xs" />
              <div className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-1 font-medium">
                  <span className="min-w-0 truncate">{person.name}</span>
                  {own && <span className="shrink-0 font-normal text-dim">(you)</span>}
                </span>
                {status && <span className="block truncate text-[13px] leading-4 text-dim">{status}</span>}
              </div>
              {badges.map((badge) => (
                <span key={badge} className="chip shrink-0">
                  {badge}
                </span>
              ))}
              {own && (
                <button type="button" onClick={() => setEditing(true)} className="btn btn-quiet btn-sm">
                  Rename
                </button>
              )}
            </li>
          );
        })}
        {inCall && (
          <li>
            <Slot>
              <VoiceSettings session={session} />
            </Slot>
          </li>
        )}
      </ul>

      {isHost(view) ? (
        <HostSwitch session={session} view={view} onToast={onToast} />
      ) : (
        isLocked(view) && (
          <p className="rail-edge border-t border-line py-3 text-[13px] text-muted">
            The host controls playback and the queue.
          </p>
        )
      )}
    </div>
  );
};

const NameEditor = ({ session, name, onDone }: { session: RoomSession; name: string; onDone: () => void }) => {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.select();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (!next) {
      setProblem('Your name can’t be empty.');
      return;
    }
    if (next === name) {
      onDone();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await session.rename(next);
      account.noteName(next);
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t save. Try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="rename" className="mb-1.5 block text-[13px] text-muted">
        Your name
      </label>
      <div className="flex gap-2">
        <input
          id="rename"
          ref={input}
          value={value}
          maxLength={MAX_NAME}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onDone()}
          autoComplete="off"
          aria-invalid={problem !== null}
          className="field h-9 min-w-0 flex-1 phone:text-base"
        />
        <button type="submit" disabled={busy} className="btn btn-primary">
          Save
        </button>
      </div>
      {problem && (
        <p role="alert" className="mt-1.5 text-[13px] text-bad">
          {problem}
        </p>
      )}
    </form>
  );
};

const HostSwitch = ({ session, view, onToast }: Props) => {
  const [busy, setBusy] = useState(false);
  const on = isLocked(view);

  const toggle = async () => {
    const mode = on ? 'everyone' : 'hosts';
    setBusy(true);
    try {
      await session.request('settings', { settings: { controlMode: mode, queueMode: mode } });
    } catch (error) {
      toastError(onToast)(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rail-edge flex items-center justify-between gap-4 border-t border-line py-3">
      <span id="host-switch" className="leading-5">
        Only I control playback and the queue
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="host-switch"
        disabled={busy || isOffline(view)}
        onClick={() => void toggle()}
        className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-primary' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-4 rounded bg-text transition-transform ${on ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  );
};
