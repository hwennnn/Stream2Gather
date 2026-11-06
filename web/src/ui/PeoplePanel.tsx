import type { RoomSession, RoomView } from '../room/session';
import { Avatar } from './Avatar';

type Props = { session: RoomSession; view: RoomView };

const STATUS_TEXT: Record<string, string> = {
  buffering: 'Buffering',
  stalled: 'Watching an ad',
  correcting: 'Catching up',
  unavailable: 'Can’t play this video',
};

export const PeoplePanel = ({ session, view }: Props) => {
  const isHost = view.self?.role === 'host';
  const hostOnly = view.settings.controlMode === 'hosts';

  return (
    <div className="flex h-full flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {view.members.map((person) => {
          const status = view.viewerStates[person.userId];
          return (
            <li key={person.userId} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <Avatar person={person} status={status} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {person.name}
                {person.userId === view.self?.userId ? ' (you)' : ''}
              </span>
              <span className="text-xs text-muted">
                {(status && STATUS_TEXT[status]) ?? (person.role === 'host' ? 'Host' : '')}
              </span>
            </li>
          );
        })}
      </ul>

      {isHost && (
        <label className="flex cursor-pointer items-center justify-between border-t border-line p-4 text-sm">
          Only I can control playback
          <input
            type="checkbox"
            checked={hostOnly}
            onChange={(event) => {
              const mode = event.target.checked ? 'hosts' : 'everyone';
              session.send('settings', { settings: { controlMode: mode, queueMode: mode } });
            }}
            className="size-4 accent-[#ff5a36]"
          />
        </label>
      )}
    </div>
  );
};
