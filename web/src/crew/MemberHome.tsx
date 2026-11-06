import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAccount } from '../auth/account';
import { AccountMenu } from '../ui/AccountMenu';
import { Avatar } from '../ui/Avatar';
import { WhereItIs } from '../ui/JoinGate';
import { firstName, seatHues } from '../ui/people';
import { Thumb } from '../ui/Thumb';
import { Wordmark } from '../ui/Wordmark';
import { inviteLink, type CrewDocument } from './api';
import { CrewSettings, MemberRow } from './CrewSettings';
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

const Invite = ({ slug, home }: Pick<Props, 'slug' | 'home'>) => {
  const link = inviteLink(slug, home.inviteToken);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const alone = home.roster.length === 1;

  // Selected on arrival, so a phone's copy menu is one tap from here too.
  useEffect(() => {
    if (alone) field.current?.select();
  }, [alone]);

  const copy = async () => {
    field.current?.select();
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
  };

  return (
    <section aria-label="Invite" className="mt-6">
      <p className="text-sm text-muted">{alone ? 'It’s just you. Copy the invite.' : 'Invite someone'}</p>
      <div className="mt-2 flex gap-2">
        <label htmlFor="crew-invite" className="sr-only">
          Invite link
        </label>
        <input id="crew-invite" ref={field} readOnly value={link} className="field min-w-0 flex-1 font-mono text-[13px]" />
        <button type="button" onClick={() => void copy()} className="btn btn-quiet shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
};

const Frame = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full flex-col">
    <header className="h-14 shrink-0 border-b border-line">
      <div className="mx-auto flex h-full max-w-xl items-center justify-between px-6 phone:px-4">
        <a href="/" aria-label="Stream2Gather home">
          <Wordmark />
        </a>
        <AccountMenu />
      </div>
    </header>
    <main className="mx-auto w-full max-w-xl flex-1 px-6 pt-8 pb-10 phone:px-4 phone:pt-6">{children}</main>
  </div>
);

/** The crew's page: who's here, what's on, and the one button that goes in. */
export const MemberHome = ({ slug, home, problem, refresh, onJoin }: Props) => {
  const { user } = useAccount();
  const [joining, setJoining] = useState(false);
  const here = home.members.length;
  seatHues(home.members.map((person) => person.userId));

  const enter = () => {
    setJoining(true);
    void onJoin(user?.name ?? '', false);
  };

  return (
    <Frame>
      <h1 className="truncate text-2xl leading-8 font-semibold tracking-[-0.015em]">{home.name}</h1>

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
          {here > 0 ? `Join the room (${here} here)` : 'Join the room'}
        </button>
      </section>

      <Suspense fallback={null}>
        <PushCard slug={slug} />
      </Suspense>

      <Invite slug={slug} home={home} />

      <Watchlist slug={slug} items={home.watchlist} onChange={refresh} />

      <Sessions slug={slug} />

      <section aria-label="Members" className="mt-8">
        <h2 className="text-sm font-semibold">Members</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {home.roster.map((person) => (
            <MemberRow key={person.userId} slug={slug} home={home} person={person} onChange={refresh} />
          ))}
        </ul>
      </section>

      <CrewSettings slug={slug} home={home} onChange={refresh} />
    </Frame>
  );
};
