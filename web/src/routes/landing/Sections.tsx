import type { Media, Person } from '../../api/http';
import { Avatar } from '../../ui/Avatar';
import { formatTime } from '../../ui/format';
import { WIDE_COLUMN } from '../../ui/Page';
import { firstName, hueOf, listNames } from '../../ui/people';
import { Thumb } from '../../ui/Thumb';

const LISTED = 4;
const REPO = 'https://github.com/hwennnn/Stream2Gather';

type PopularProps = { items: Media[] | null; busy: string | null; disabled: boolean; onPick: (media: Media) => void };

/** YouTube's most popular videos today. A pick opens a room with it playing. */
export const Popular = ({ items, busy, disabled, onPick }: PopularProps) => {
  if (items?.length === 0) return null;
  return (
    <section aria-labelledby="popular-title" className="order-2 mt-12 phone:mt-8">
      <h2 id="popular-title" className="text-[15px] font-semibold">
        Popular on YouTube today
      </h2>
      <ol className="mt-3 grid grid-cols-4 gap-4 phone:grid-cols-2 phone:gap-3">
        {items
          ? items.slice(0, LISTED).map((media) => (
              <li key={media.sourceId} className="min-w-0">
                <button type="button" disabled={disabled} onClick={() => onPick(media)} aria-label={`Start a room with ${media.title}`} className="group block w-full cursor-pointer text-left disabled:cursor-default">
                  <Thumb src={media.thumbnailUrl} className="w-full rounded-md" />
                  <span className="mt-2 line-clamp-2 text-[13px] leading-[18px] font-medium">{media.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs leading-4 text-muted">
                    <span className="min-w-0 truncate">{media.author}</span>
                    {busy === media.sourceId ? <span className="spinner size-3" /> : media.durationMs > 0 && <span className="fig text-dim">{formatTime(media.durationMs / 1000)}</span>}
                  </span>
                </button>
              </li>
            ))
          : Array.from({ length: LISTED }, (_, index) => <li key={index} aria-hidden="true" className="skeleton aspect-video rounded-md" />)}
      </ol>
    </section>
  );
};

type Face = Pick<Person, 'userId' | 'name' | 'avatarUrl'>;

export const inThere = (people: Face[]): string => {
  const names = people.map(({ name }) => firstName(name));
  return names.length > 0 ? `${listNames(names)} ${names.length > 1 ? 'are' : 'is'} in there now.` : 'Nobody’s in there right now.';
};

/** A way back to people: who they are, where, and Join. */
export const ReturnRow = ({ href, title, note, people }: { href: string; title: string; note: string; people: Face[] }) => (
  <a href={href} className="flex min-h-14 items-center gap-3 py-2">
    {people.length > 0 && (
      <span className="flex shrink-0 -space-x-1.5">
        {people.slice(0, 3).map((person) => (
          <Avatar key={person.userId} person={person} labelled={false} className="size-8 text-xs ring-2 ring-ink" />
        ))}
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold">{title}</span>
      <span className="block text-[13px] text-muted">{note}</span>
    </span>
    <span className="btn btn-quiet btn-sm shrink-0">Join</span>
  </a>
);

const CAST = [
  { userId: 'picture-maya', name: 'Maya', role: 'host' as const },
  { userId: 'picture-sam', name: 'Sam', role: 'member' as const },
  { userId: 'picture-priya', name: 'Priya', role: 'member' as const },
  { userId: 'picture-you', name: 'You', role: 'member' as const },
];

const LINES: [number, string][] = [
  [1, 'is this the one with the dog'],
  [2, 'yes. shh'],
  [0, 'door, one sec'],
  [3, 'what did i miss'],
  [1, 'nothing, she paused it'],
  [2, 'wait for this part'],
  [1, 'no spoilers'],
  [3, 'ok back, go'],
];
/** A phone has room for the end of the conversation. */
const PHONE_LINES = 3;

/** A picture of a room, not a live one: only the video in it is real. */
export const RoomPicture = ({ media }: { media: Media | null }) => (
  <figure className="min-w-0">
    <div aria-hidden="true" className="flex overflow-hidden rounded-lg border border-line bg-ink phone:flex-col">
      <div className="min-w-0 flex-1">
        <div className="aspect-video bg-stage">
          <img src={media?.thumbnailUrl ?? '/room-still.svg'} alt="" className="size-full object-cover" />
        </div>
        <ul className="seats px-3 pt-3">
          {CAST.map((person, index) => (
            <li key={person.userId} data-acting={index === 0} style={{ '--hue': hueOf(person.userId) } as React.CSSProperties} className="seat">
              <span className="seat-disc">
                <Avatar person={person} labelled={false} className="size-full text-[13px]" />
                {index === 1 && <span className="seat-reaction">😂</span>}
              </span>
              <span className="seat-name">{person.name}</span>
            </li>
          ))}
          <li className="seat seat-spare">
            <span className="seat-empty" />
          </li>
        </ul>
        <p className="truncate px-4 pt-3 pb-3 text-[13px] text-muted">
          Paused by{' '}
          <span style={{ color: hueOf(CAST[0]?.userId ?? '') }} className="font-semibold">
            Maya
          </span>{' '}
          at <span className="fig text-[13px]">3:20</span>
        </p>
      </div>
      <div className="flex w-44 shrink-0 flex-col justify-end gap-2.5 overflow-hidden border-l border-line bg-panel p-3 text-[13px] leading-[18px] phone:w-full phone:border-t phone:border-l-0">
        {LINES.map(([who, text], index) => {
          const person = CAST[who];
          return (
            person && (
              <p key={text} className={index < LINES.length - PHONE_LINES ? 'phone:hidden' : undefined}>
                <span style={{ color: hueOf(person.userId) }} className="mr-1.5 font-semibold">
                  {person.name}
                </span>
                {text}
              </p>
            )
          );
        })}
      </div>
    </div>
  </figure>
);

export const Footer = () => (
  <footer className="border-t border-line">
    <div className={`${WIDE_COLUMN} flex flex-wrap justify-between gap-x-6 gap-y-1 py-4 text-[13px] text-dim`}>
      <span>Videos play in each site’s own player.</span>
      <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-text">
        GitHub
      </a>
    </div>
  </footer>
);
