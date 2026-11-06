import type { Person } from '../api/http';
import { avatarColor, initials } from './format';

const RINGS: Record<string, string> = {
  buffering: 'ring-warn',
  stalled: 'ring-warn',
  unavailable: 'ring-accent',
  correcting: 'ring-warn',
};

export const Avatar = ({ person, status }: { person: Person; status?: string }) => (
  <span
    title={person.name}
    style={{ background: avatarColor(person.userId) }}
    className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-ink ring-2 ${
      (status && RINGS[status]) ?? 'ring-ink'
    }`}
  >
    {initials(person.name)}
  </span>
);
