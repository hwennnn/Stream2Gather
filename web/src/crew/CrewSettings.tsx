import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';
import { useAccount } from '../auth/account';
import { navigate } from '../routes/router';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { firstName } from '../ui/people';
import { crewApi, type CrewDocument, type RosterEntry } from './api';

const PushSettings = lazy(() => import('../push/Card').then((card) => ({ default: card.PushSettings })));

export const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4.5">
    <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
    <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

type ConfirmProps = { label: string; confirm: string; onYes: () => void; className?: string; armedClassName?: string };

/** Asks once more in place, because what it does can't be undone. */
const Confirm = ({ label, confirm, onYes, className = 'btn btn-ghost btn-sm -mr-2.5 text-text', armedClassName = 'font-semibold' }: ConfirmProps) => {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" onClick={() => (armed ? onYes() : setArmed(true))} onBlur={() => setArmed(false)} className={`${className} ${armed ? armedClassName : ''}`}>
      {armed ? confirm : label}
    </button>
  );
};

const ITEM = 'block w-full cursor-pointer rounded-md px-3 py-2 text-left text-[13px] whitespace-normal transition-colors hover:bg-raised';

/** The two things only an owner does to someone, kept off the row until asked for. */
const RowMenu = ({ name, onHandOver, onRemove }: { name: string; onHandOver: () => void; onRemove: () => void }) => {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent | KeyboardEvent) => {
      const outside = event instanceof PointerEvent && !menu.current?.contains(event.target as Node);
      if (outside || (event instanceof KeyboardEvent && event.key === 'Escape')) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={menu} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-label={`Actions for ${name}`} onClick={() => setOpen(!open)} className="btn btn-ghost btn-sm btn-icon -mr-1.5 text-text">
        <Icon name="more" />
      </button>
      {open && (
        <div className="float absolute top-full right-0 z-30 mt-1 w-52 p-1.5">
          <Confirm label="Make owner" confirm={`Hand over to ${firstName(name)}?`} onYes={onHandOver} className={ITEM} />
          <Confirm label="Remove" confirm={`Remove ${firstName(name)}?`} onYes={onRemove} className={ITEM} />
        </div>
      )}
    </div>
  );
};

type RowProps = { slug: string; home: CrewDocument; person: RosterEntry; onChange: () => void };

const MemberRow = ({ slug, home, person, onChange }: RowProps) => {
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
      {owner && <span className="text-dim">Owner</span>}
      {iOwn && !owner && <RowMenu name={person.name} onHandOver={() => void crewApi.edit(slug, { ownerId: person.userId }).then(onChange, onChange)} onRemove={leave} />}
      {self && !owner && <Confirm label="Leave" confirm="Leave this crew?" onYes={leave} />}
    </li>
  );
};

type Props = { slug: string; home: CrewDocument; onChange: () => void };

/** The owner's controls. Nobody else has any here. */
const CrewSettings = ({ slug, home, onChange }: Props) => {
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
            <button type="button" onClick={() => setRenaming(true)} className="btn btn-ghost btn-sm -mr-2.5 text-text">
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
          <Confirm label="Close" confirm="Close it for everyone?" onYes={close} className="btn btn-ghost btn-sm -mr-2.5 text-bad hover:text-bad" />
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

type AdminProps = Props & { onBack: () => void };

/** Everything that isn't tonight: who's on the crew, and how it's set up. */
export const CrewAdmin = ({ slug, home, onChange, onBack }: AdminProps) => (
  <>
    <button type="button" autoFocus onClick={onBack} className="btn btn-ghost btn-sm -ml-2.5 max-w-full text-text">
      <Icon name="back" className="size-3.5 shrink-0" />
      <span className="truncate">{home.name}</span>
    </button>
    <section aria-label="Members" className="mt-4">
      <h2 className="text-sm font-semibold">Members</h2>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {home.roster.map((person) => (
          <MemberRow key={person.userId} slug={slug} home={home} person={person} onChange={onChange} />
        ))}
      </ul>
    </section>
    <Suspense fallback={null}>
      <PushSettings slug={slug} />
    </Suspense>
    <CrewSettings slug={slug} home={home} onChange={onChange} />
  </>
);
