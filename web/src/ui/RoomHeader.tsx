import { lazy, type ReactNode } from 'react';
import type { PlayerAdapter } from '../players/types';
import type { RoomSession, RoomView } from '../room/session';
import { AccountMenu } from './AccountMenu';
import { Icon } from './Icon';
import { LeaveLink } from './LeaveLink';
import { Mark } from './Mark';
import { isLocked } from './rules';
import { Seats } from './Seats';
import type { Row } from './seatRow';
import { Slot } from './Slot';

const KeepRoom = lazy(() => import('../crew/KeepRoom'));
const VoiceButton = lazy(() => import('../voice/VoiceButton'));

type RoomHeaderProps = {
  session: RoomSession;
  view: RoomView;
  adapter: () => PlayerAdapter | null;
  /** Controls that move up here when a sideways phone hides the bar under the player. */
  landscapeControls: ReactNode;
  row: Row;
  actor: string | null;
  /** Where the connection note goes when there's no bar to hold it. */
  note: ReactNode;
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

export const RoomHeader = ({ session, view, adapter, row, actor, note, landscapeControls, onAccountOpen, onInvite, onPeople }: RoomHeaderProps) => (
  <header className="room-header flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 phone:h-14 phone:gap-0 phone:px-1 land:h-10 land:gap-2 land:pr-[max(0.5rem,env(safe-area-inset-right))] land:pl-[max(0.25rem,env(safe-area-inset-left))]">
    <LeaveLink session={session} aria-label="Leave the room" className="shrink-0 phone:hidden land:hidden">
      <Mark />
    </LeaveLink>
    <LeaveLink session={session} aria-label="Leave room" className="hidden size-11 shrink-0 items-center justify-center text-muted phone:flex land:flex land:size-9">
      <Icon name="back" className="size-5" />
    </LeaveLink>
    <h1 className="min-w-0 truncate text-[15px] font-semibold phone:sr-only land:sr-only">{view.name}</h1>
    {isLocked(view) && <HostChip className="phone:hidden" />}
    <div className="hidden min-w-0 phone:block land:block">
      <Seats view={view} row={row} actor={actor} onInvite={onInvite} onPeople={onPeople} compact />
    </div>

    <div className="ml-auto flex min-w-0 shrink-0 items-center gap-3 land:gap-1.5">
      {note}
      <div className="hidden items-center gap-1.5 land:flex">{landscapeControls}</div>
      <Slot>
        <VoiceButton session={session} view={view} adapter={adapter} />
      </Slot>
      <Slot>
        <KeepRoom session={session} view={view} />
      </Slot>
      <LeaveLink session={session} className="btn btn-quiet btn-sm phone:hidden land:hidden">
        Leave
      </LeaveLink>
      <AccountMenu onOpen={onAccountOpen} />
    </div>
  </header>
);
