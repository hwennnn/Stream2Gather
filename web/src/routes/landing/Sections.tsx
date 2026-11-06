import type { Media, Person } from '../../api/http';
import { Avatar } from '../../ui/Avatar';
import { formatTime } from '../../ui/format';
import { WIDE_COLUMN } from '../../ui/Page';
import { firstName, hueOf, listNames } from '../../ui/people';
import { Thumb } from '../../ui/Thumb';

const LISTED = 4;
/** The first one is already on the screen above. */
const SHOWN_ABOVE = 1;
const REPO = 'https://github.com/hwennnn/Stream2Gather';

type PopularProps = { items: Media[] | null; busy: string | null; disabled: boolean; onPick: (media: Media) => void };

/** YouTube's most popular videos today. A pick opens a room with it playing. */
export const Popular = ({ items, busy, disabled, onPick }: PopularProps) => {
  if (items?.length === 0) return null;
  return (
    <section aria-labelledby="popular-title" className="order-2 mt-10 phone:mt-8">
      <h2 id="popular-title" className="text-[15px] font-semibold">
        Popular on YouTube today
      </h2>
      <ol className="mt-3 grid grid-cols-4 gap-4 phone:grid-cols-2 phone:gap-3">
        {items
          ? items.slice(SHOWN_ABOVE, SHOWN_ABOVE + LISTED).map((media) => (
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

type Line = { text: string; at: number; stays?: boolean };
type Sitter = { userId: string; name: string; sat: number; lines?: Line[]; reacts?: { emoji: string; at: number }; pauses?: number };

/** Five seconds in a room, once through, and it stops on the seat nobody's in. Only the video is real. */
const CAST: Sitter[] = [
  { userId: 'picture-maya', name: 'Maya', sat: 120, pauses: 2800, lines: [{ text: 'door, one sec', at: 2800 }] },
  { userId: 'picture-sam', name: 'Sam', sat: 240, lines: [{ text: 'is this the one with the dog', at: 600 }, { text: 'we’ll wait', at: 3900, stays: true }] },
  { userId: 'picture-priya', name: 'Priya', sat: 360, lines: [{ text: 'yes. shh', at: 1700 }], reacts: { emoji: '😂', at: 1700 } },
  { userId: 'picture-you', name: 'You', sat: 480 },
];
const MISSING_AT = 4300;
const PAUSED_AT = 2800;

const at = (name: string, ms: number) => ({ [name]: `${ms}ms` }) as React.CSSProperties;

const Seat = ({ person }: { person: Sitter }) => (
  <li style={{ '--hue': hueOf(person.userId), ...at('--sat', person.sat) } as React.CSSProperties} className="seat picture-seat">
    {person.lines?.map((line) => (
      <span key={line.text} data-stays={line.stays} style={at('--at', line.at)} className="picture-say">
        {line.text}
      </span>
    ))}
    <span className="seat-disc">
      <Avatar person={person} labelled={false} className="size-full" />
      {person.pauses !== undefined && <span style={at('--at', person.pauses)} className="picture-ring" />}
      {person.reacts && (
        <span style={at('--at', person.reacts.at)} className="seat-reaction picture-react">
          {person.reacts.emoji}
        </span>
      )}
    </span>
    <span className="seat-name">{person.name}</span>
  </li>
);

/** The screen in the picture. A pasted link puts its own video here before there's a room. */
export const PictureScreen = ({ src, onBroken }: { src: string; onBroken: () => void }) => (
  <figure aria-hidden="true" className="aspect-video overflow-hidden rounded-lg bg-stage">
    <img key={src} src={src} alt="" onError={onBroken} className="enter size-full object-cover" />
  </figure>
);

/** Everyone in front of that screen, and a place for whoever you're about to send this to. */
export const FrontRow = ({ ready }: { ready: boolean }) => {
  const maya = CAST[0]?.userId;
  return (
    <div aria-hidden="true" data-ready={ready} className="picture-row">
      <ul className="seats">
        {CAST.map((person) => (
          <Seat key={person.userId} person={person} />
        ))}
        <li className="seat picture-seat">
          <span className="seat-empty picture-open" />
          <span style={at('--at', MISSING_AT)} className="seat-name picture-missing">
            Who’s missing?
          </span>
        </li>
      </ul>
      <p className="picture-status">
        <span style={at('--at', PAUSED_AT)} className="picture-before">
          Playing at <span className="tabular-nums">3:12</span>, everyone together
        </span>
        <span style={at('--at', PAUSED_AT)} className="picture-after">
          Paused by{' '}
          <span style={{ color: hueOf(maya) }} className="font-semibold">
            Maya
          </span>{' '}
          at <span className="tabular-nums">3:20</span>
        </span>
        <span className="picture-ready">That’s your screen. Start the room, then send the link.</span>
      </p>
    </div>
  );
};

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
