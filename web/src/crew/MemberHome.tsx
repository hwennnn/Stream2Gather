import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAccount } from '../auth/account';
import { AccountMenu } from '../ui/AccountMenu';
import { Avatar } from '../ui/Avatar';
import { WhereItIs } from '../ui/JoinGate';
import { NARROW_COLUMN, SiteHeader } from '../ui/Page';
import { firstName } from '../ui/people';
import { Thumb } from '../ui/Thumb';
import { inviteLink, type CrewDocument } from './api';
import { CrewAdmin, GearIcon } from './CrewSettings';
import { Sessions } from './Sessions';
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

const Frame = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full flex-col">
    <SiteHeader>
      <AccountMenu />
    </SiteHeader>
    <main className={`${NARROW_COLUMN} flex-1 pt-8 pb-10 phone:pt-6`}>{children}</main>
  </div>
);

/** The crew's page: who's here, what's on, and the one button that goes in. */
export const MemberHome = ({ slug, home, problem, refresh, onJoin }: Props) => {
  const { user } = useAccount();
  const [joining, setJoining] = useState(false);
  const [admin, setAdmin] = useState(false);
  const here = home.members.length;

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

  return (
    <Frame>
      <div className="flex items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl leading-8 font-semibold tracking-[-0.015em]">{home.name}</h1>
        <button type="button" aria-label="Members and settings" onClick={() => setAdmin(true)} className="btn btn-ghost btn-icon -mr-2 text-text">
          <GearIcon />
        </button>
      </div>

      {problem && (
        <p role="status" className="mt-4 text-sm text-warn">
          {problem}
        </p>
      )}

      <section aria-label="Now" className="mt-6">
        {home.nowPlaying && (
          <div className="mb-4 flex items-center gap-3">
            <Thumb src={home.nowPlaying.thumbnailUrl} className="w-28 rounded-md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{home.nowPlaying.title}</p>
              <WhereItIs preview={home} />
            </div>
          </div>
        )}
        {here === 0 && <p className="mb-4 text-sm text-muted">Nobody’s here</p>}
        {here > 0 && (
          <ul aria-label="Here now" data-gate="true" className="seats mb-4">
            {home.members.map((person) => (
              <li key={person.userId} className="seat">
                <span className="seat-disc">
                  <Avatar person={person} labelled={false} className="size-full text-[13px]" />
                </span>
                <span className="seat-name">{firstName(person.name)}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" disabled={joining} onClick={enter} className="btn btn-primary h-12 w-full text-base">
          Join the room
        </button>
      </section>

      <Invite slug={slug} home={home} />

      <Suspense fallback={null}>
        <PushCard />
      </Suspense>

      <Watchlist slug={slug} items={home.watchlist} onChange={refresh} />

      <Sessions slug={slug} />

    </Frame>
  );
};
