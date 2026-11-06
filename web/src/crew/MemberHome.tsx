import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAccount } from '../auth/account';
import { Missed } from '../catchup/Missed';
import { RecapCard } from '../recap/RecapCard';
import { nightOf } from '../recap/words';
import { AccountMenu } from '../ui/AccountMenu';
import { Avatar } from '../ui/Avatar';
import { WhereItIs } from '../ui/JoinGate';
import { NARROW_COLUMN, SiteHeader, WIDE_COLUMN } from '../ui/Page';
import { firstName, listNames } from '../ui/people';
import { Thumb } from '../ui/Thumb';
import { inviteLink, type CrewDocument } from './api';
import { CrewAdmin, GearIcon } from './CrewSettings';
import { Sessions, useSessions } from './Sessions';
import { Watchlist } from './Watchlist';

const PushCard = lazy(() => import('../push/Card'));

type Props = {
  slug: string;
  home: CrewDocument;
  problem: string | null;
  refresh: () => void;
  onJoin: (name: string, changed: boolean) => Promise<void>;
};

/** One row once there's company. The link itself only shows when someone has to copy it by hand. */
const Invite = ({ slug, home }: Pick<Props, 'slug' | 'home'>) => {
  const link = inviteLink(slug, home.inviteToken);
  const [copied, setCopied] = useState(false);
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const alone = home.roster.length === 1;
  const shown = alone || refused;

  // Selected on arrival, so a phone's copy menu is one tap from here too.
  useEffect(() => {
    if (alone) field.current?.select();
  }, [alone]);

  const copy = async () => {
    field.current?.select();
    const saved = await navigator.clipboard.writeText(link).then(() => true, () => false);
    setCopied(saved);
    setRefused(!saved);
  };

  return (
    <section aria-label="Invite" className="mt-4 border-t border-line pt-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">{alone ? 'It’s just you. Copy the invite.' : 'Invite someone'}</p>
        <button type="button" onClick={() => void copy()} className="btn btn-quiet shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <label htmlFor="crew-invite" className="sr-only">
        Invite link
      </label>
      <input id="crew-invite" ref={field} readOnly value={link} tabIndex={shown ? undefined : -1} className={shown ? 'field mt-2 w-full text-[13px]' : 'sr-only'} />
    </section>
  );
};

/** How many seats a crew's page draws before it counts the rest. */
const SEATS = 11;

/** Everyone keeps their seat, here tonight or not. Whoever's in is lit, and the last place is the next person's. */
const CrewSeats = ({ home }: { home: CrewDocument }) => {
  const here = new Set(home.members.map(({ userId }) => userId));
  const visitors = home.members.filter(({ userId }) => !home.roster.some((member) => member.userId === userId));
  const everyone = [...home.roster, ...visitors];
  return (
    <ul aria-label="The crew" data-kept="true" className="seats mt-4">
      {everyone.slice(0, SEATS).map((person) => (
        <li key={person.userId} data-away={!here.has(person.userId)} data-here={here.has(person.userId)} className="seat">
          <span className="seat-disc">
            <Avatar person={person} labelled={false} className="size-full" />
          </span>
          <span className="seat-name">{firstName(person.name)}</span>
        </li>
      ))}
      {everyone.length > SEATS && (
        <li className="seat">
          <span className="seat-more">+{everyone.length - SEATS}</span>
        </li>
      )}
      <li aria-hidden="true" className="seat">
        <span className="seat-empty" />
      </li>
    </ul>
  );
};

/** Who's in now, or when the crew last sat down. An empty room is for the button to say. */
const whoIsIn = (home: CrewDocument, lastNight?: string): string | null => {
  const names = home.members.map(({ name }) => firstName(name));
  if (names.length > 0) return `${listNames(names)} ${names.length > 1 ? 'are' : 'is'} in.`;
  return lastNight ? `Last together ${nightOf(lastNight)}.` : null;
};

const Frame = ({ wide, children }: { wide?: boolean; children: ReactNode }) => (
  <div className="flex min-h-full flex-col">
    <SiteHeader>
      <AccountMenu />
    </SiteHeader>
    <main className={`${wide ? WIDE_COLUMN : NARROW_COLUMN} flex-1 pt-8 pb-10 phone:pt-6`}>{children}</main>
  </div>
);

/** The crew's page: who's here, what's on, and the one button that goes in. */
export const MemberHome = ({ slug, home, problem, refresh, onJoin }: Props) => {
  const { user } = useAccount();
  const [joining, setJoining] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [sessions, setSessions] = useSessions(slug);
  const latest = sessions?.items[0];

  const enter = () => {
    setJoining(true);
    void onJoin(user?.name ?? '', false);
  };

  if (admin) {
    return (
      <Frame>
        <CrewAdmin slug={slug} home={home} onChange={refresh} onBack={() => setAdmin(false)} />
      </Frame>
    );
  }

  const line = whoIsIn(home, latest?.startedAt);

  return (
    <Frame wide>
      <div className="crew-home">
        <div className="crew-door">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-muted">Your crew</p>
              <h1 className="truncate text-2xl leading-8 font-semibold tracking-[-0.015em]">{home.name}</h1>
            </div>
            <button type="button" aria-label="Members and settings" onClick={() => setAdmin(true)} className="btn btn-ghost btn-icon -mr-2 text-text">
              <GearIcon />
            </button>
          </div>

          {problem && (
            <p role="status" className="mt-4 text-sm text-warn">
              {problem}
            </p>
          )}

          <CrewSeats home={home} />
          {line && <p className="mt-3 text-sm text-muted">{line}</p>}

          <section aria-label="Now" className="mt-3">
            {home.nowPlaying && (
              <div className="mb-3 flex items-center gap-3">
                <Thumb src={home.nowPlaying.thumbnailUrl} className="w-20 rounded-md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{home.nowPlaying.title}</p>
                  <WhereItIs preview={home} />
                </div>
              </div>
            )}
            <button type="button" disabled={joining} onClick={enter} className="btn btn-primary h-12 w-full text-base">
              {home.members.length > 0 ? 'Join the room' : 'Be the first in'}
            </button>
          </section>

          <Invite slug={slug} home={home} />

          <Suspense fallback={null}>
            <PushCard />
          </Suspense>
        </div>

        <div className="crew-nights">
          <Missed slug={slug} />

          {latest && <RecapCard key={latest.id} slug={slug} sessionId={latest.id} people={latest.people} />}

          <Watchlist slug={slug} items={home.watchlist} selfId={user?.id} onChange={refresh} />

          <Sessions slug={slug} page={sessions} setPage={setSessions} />
        </div>
      </div>
    </Frame>
  );
};
