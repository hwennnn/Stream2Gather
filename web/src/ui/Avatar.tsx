import type { Person } from '../api/http';
import { avatarColor, initials } from './format';

const RINGS = new Map([
  ['buffering', 'ring-warn'],
  ['stalled', 'ring-warn'],
  ['unavailable', 'ring-accent'],
  ['correcting', 'ring-warn'],
]);

type AvatarProps = {
  person: Pick<Person, 'userId' | 'name' | 'avatarUrl'>;
  status?: string;
  className?: string;
  /** Off in the header, where a tooltip would open over the player. */
  labelled?: boolean;
};

export const Avatar = ({ person, status, className = 'size-7 text-[11px]', labelled = true }: AvatarProps) => (
  <span
    title={labelled ? person.name : undefined}
    style={{ background: avatarColor(person.userId) }}
    className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none font-bold text-ink ring-2 ${
      (status && RINGS.get(status)) ?? 'ring-ink'
    } ${className}`}
  >
    {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="size-full object-cover" /> : initials(person.name)}
  </span>
);
