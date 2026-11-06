import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';
import { useAccount } from '../auth/account';
import { navigate } from '../routes/router';
import { Avatar } from '../ui/Avatar';
import { crewApi, type CrewDocument, type RosterEntry } from './api';

/** Asks once more in place, because what it does can't be undone. */
const Confirm = ({ label, confirm, onYes }: { label: string; confirm: string; onYes: () => void }) => {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (armed ? onYes() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={`btn btn-sm -mr-2.5 ${armed ? 'text-bad' : 'btn-ghost'}`}
    >
      {armed ? confirm : label}
    </button>
  );
};

type RowProps = { slug: string; home: CrewDocument; person: RosterEntry; onChange: () => void };

export const MemberRow = ({ slug, home, person, onChange }: RowProps) => {
  const { user } = useAccount();
  const owner = person.userId === home.ownerId;
  const self = person.userId === user?.id;
  const iOwn = user?.id === home.ownerId;

  const leave = () => {
    crewApi.removeMember(slug, person.userId).then(() => (self ? navigate('/') : onChange()), onChange);
  };

  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 py-1 text-sm">
      <Avatar person={person} />
      <span className="min-w-0 flex-1 truncate">{person.name}</span>
      {owner && <span className="text-muted">Owner</span>}
      {iOwn && !owner && (
        <Confirm label="Make owner" confirm={`Hand over to ${person.name}?`} onYes={() => void crewApi.edit(slug, { ownerId: person.userId }).then(onChange, onChange)} />
      )}
      {iOwn && !owner && <Confirm label="Remove" confirm={`Remove ${person.name}?`} onYes={leave} />}
      {self && !owner && <Confirm label="Leave" confirm="Leave this crew?" onYes={leave} />}
    </li>
  );
};

type Props = { slug: string; home: CrewDocument; onChange: () => void };

/** The owner's controls. Nobody else has any here. */
export const CrewSettings = ({ slug, home, onChange }: Props) => {
  const { user } = useAccount();
  const [name, setName] = useState(home.name);
  const [renaming, setRenaming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (user?.id !== home.ownerId) return null;

  const failed = (error: unknown) => setProblem(error instanceof ApiError ? error.message : 'That didn’t work. Try again.');
  const apply = (step: Promise<unknown>) => {
    setProblem(null);
    step.then(onChange, failed);
  };
  const rename = (event: FormEvent) => {
    event.preventDefault();
    setRenaming(false);
    if (name.trim() !== home.name) apply(crewApi.edit(slug, { name: name.trim() }));
  };
  const close = () => {
    crewApi.close(slug).then(() => navigate('/'), failed);
  };

  return (
    <section aria-label="Crew settings" className="mt-8 pb-8">
      <h2 className="text-sm font-semibold">Settings</h2>
      <div className="mt-2 divide-y divide-line border-y border-line text-sm">
        {renaming ? (
          <form onSubmit={rename} className="flex items-center gap-2 py-2">
            <label htmlFor="crew-rename" className="sr-only">
              Crew name
            </label>
            <input id="crew-rename" autoFocus value={name} maxLength={32} onChange={(event) => setName(event.target.value)} autoComplete="off" className="field min-w-0 flex-1" />
            <button type="submit" disabled={!name.trim()} className="btn btn-quiet">
              Save
            </button>
          </form>
        ) : (
          <div className="flex min-h-11 items-center justify-between gap-4 py-1">
            <span>Name</span>
            <button type="button" onClick={() => setRenaming(true)} className="btn btn-ghost btn-sm -mr-2.5">
              Rename
            </button>
          </div>
        )}
        <div className="flex min-h-11 items-center justify-between gap-4 py-1">
          <span id="crew-guests">Guests can enter the room</span>
          <button
            type="button"
            role="switch"
            aria-checked={home.guestAccess}
            aria-labelledby="crew-guests"
            onClick={() => apply(crewApi.edit(slug, { guestAccess: !home.guestAccess }))}
            className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors ${home.guestAccess ? 'bg-primary' : 'bg-white/15'}`}
          >
            <span className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${home.guestAccess ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4 py-1">
          <span>Invite link</span>
          <Confirm label="Reset" confirm="Old link stops working. Reset?" onYes={() => apply(crewApi.rotate(slug))} />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4 py-1">
          <span>Close this crew</span>
          <Confirm label="Close" confirm="Close it for everyone?" onYes={close} />
        </div>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-warn">
          {problem}
        </p>
      )}
    </section>
  );
};
