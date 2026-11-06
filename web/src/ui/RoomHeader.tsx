import type { ReactNode } from 'react';
import type { RoomView } from '../room/session';
import { AccountMenu } from './AccountMenu';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { isLocked } from './rules';

const SHOWN = 4;

type RoomHeaderProps = {
  view: RoomView;
  /** Controls that move up here when a sideways phone hides the bar under the player. */
  landscapeControls: ReactNode;
  onAccountOpen: () => void;
  onInvite: () => void;
  onPeople: () => void;
};

export const HostChip = ({ className = '' }: { className?: string }) => (
  <span className={`chip ${className}`}>
    <Icon name="lock" className="size-3" />
    Host controls
  </span>
);

export const RoomHeader = ({ view, landscapeControls, onAccountOpen, onInvite, onPeople }: RoomHeaderProps) => {
  const extra = view.members.length - SHOWN;
  return (
    <header className="room-header flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4 land:h-10 land:gap-2 land:pr-[max(0.5rem,env(safe-area-inset-right))] land:pl-[max(0.75rem,env(safe-area-inset-left))]">
      <a href="/" aria-label="Stream2Gather home" className="shrink-0 rounded-md">
        <img src="/favicon.svg" alt="" className="size-6 land:size-5" />
      </a>
      <h1 className="min-w-0 truncate text-sm font-semibold">{view.name}</h1>
      {isLocked(view) && <HostChip className="phone:hidden" />}

      <div className="ml-auto flex shrink-0 items-center gap-3 land:gap-1.5">
        <div className="hidden items-center gap-1.5 land:flex">{landscapeControls}</div>
        <button
          type="button"
          onClick={onPeople}
          aria-label={`${view.members.length === 1 ? '1 person' : `${view.members.length} people`} in the room. Open People`}
          className="hidden cursor-pointer items-center -space-x-0.5 rounded-full sm:flex land:hidden"
        >
          {view.members.slice(0, SHOWN).map((person) => (
            <Avatar key={person.userId} person={person} status={view.viewerStates[person.userId]} labelled={false} />
          ))}
          {extra > 0 && (
            <span className="relative flex h-7 min-w-7 items-center justify-center rounded-full bg-raised px-1.5 text-[11px] font-semibold text-muted ring-2 ring-ink">
              +{extra}
            </span>
          )}
        </button>
        <button type="button" onClick={onInvite} className="btn btn-primary">
          Invite
        </button>
        <AccountMenu onOpen={onAccountOpen} />
      </div>
    </header>
  );
};
