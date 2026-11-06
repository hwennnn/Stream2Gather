import type { Person } from '../api/http';
import { initials } from './format';
import { hueOf } from './people';

type AvatarProps = {
  person: Pick<Person, 'userId' | 'name' | 'avatarUrl'>;
  className?: string;
  /** Off in the header, where a tooltip would open over the player. */
  labelled?: boolean;
};

/** A person's disc, in their own hue. */
export const Avatar = ({ person, className = 'size-6 text-[11px]', labelled = true }: AvatarProps) => (
  <span
    title={labelled ? person.name : undefined}
    style={{ backgroundColor: hueOf(person.userId) }}
    className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none font-semibold text-ink ${className}`}
  >
    <span className="avatar-face flex size-full items-center justify-center">{person.avatarUrl ? <img src={person.avatarUrl} alt="" className="size-full object-cover" /> : initials(person.name)}</span>
  </span>
);
