import { useEffect, useRef, useState, type FormEvent } from 'react';
import { account } from '../auth/account';
import type { RoomSession, RoomView } from '../room/session';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { isHost, isLocked, isOffline } from './rules';
import { toastError } from './Toasts';

type Props = { session: RoomSession; view: RoomView; onToast: (text: string) => void };

const STATUS_TEXT = new Map([
  ['buffering', 'Buffering'],
  ['stalled', 'Watching an ad'],
  ['correcting', 'Catching up'],
  ['unavailable', 'Can’t play this video'],
]);

const MAX_NAME = 32;

export const PeoplePanel = ({ session, view, onToast }: Props) => {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {view.members.map((person) => {
          const own = person.userId === view.self?.userId;
          const status = view.viewerStates[person.userId];
          const detail = (status && STATUS_TEXT.get(status)) ?? (person.role === 'host' ? 'Host' : '');

          if (own && editing) {
            return (
              <li key={person.userId} className="px-2 py-1.5">
                <NameEditor session={session} name={view.self?.name ?? person.name} onDone={() => setEditing(false)} />
              </li>
            );
          }
          return (
            <li key={person.userId} className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-1.5">
              <Avatar person={person} status={status} className={`size-8 text-xs ${status ? '' : 'ring-panel!'}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {person.name}
                {own && <span className="font-normal text-muted"> (you)</span>}
              </span>
              {detail && <span className="shrink-0 text-xs text-muted">{detail}</span>}
              {own && (
                <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">
                  <Icon name="pencil" className="size-3.5" />
                  Edit
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {isHost(view) ? (
        <HostSwitch session={session} view={view} onToast={onToast} />
      ) : (
        isLocked(view) && (
          <p className="flex items-center gap-2 border-t border-line p-4 text-[13px] text-muted">
            <Icon name="lock" className="size-3.5 shrink-0" />
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
      <label htmlFor="rename" className="mb-1.5 block text-xs text-muted">
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
          className="field h-9 min-w-0 flex-1"
        />
        <button type="submit" disabled={busy} className="btn btn-primary">
          Save
        </button>
      </div>
      {problem && (
        <p role="alert" className="mt-1.5 text-[13px] text-warn">
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
    <div className="flex items-center justify-between gap-4 border-t border-line p-4">
      <span id="host-switch" className="text-sm leading-snug">
        Only I can control playback and the queue
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="host-switch"
        disabled={busy || isOffline(view)}
        onClick={() => void toggle()}
        className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-accent' : 'bg-white/15'}`}
      >
        <span className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
};
