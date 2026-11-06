import { useEffect, useState } from 'react';
import type { RoomView } from '../room/session';
import { Avatar } from './Avatar';

type RoomHeaderProps = { slug: string; view: RoomView; copied: boolean };

export const RoomHeader = ({ slug, view, copied }: RoomHeaderProps) => {
  const [confirmed, setConfirmed] = useState(copied);

  useEffect(() => {
    if (!confirmed) return undefined;
    const timer = window.setTimeout(() => setConfirmed(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirmed]);

  const share = async () => {
    const url = `${window.location.origin}/r/${slug}`;
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: view.name, url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url);
    setConfirmed(true);
  };

  return (
    <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
      <a href="/" aria-label="Stream2Gather home">
        <img src="/favicon.svg" alt="" className="size-6" />
      </a>
      <h1 className="min-w-0 truncate text-sm font-semibold">{view.name}</h1>
      {view.connection === 'reconnecting' && <span className="text-xs text-warn">Reconnecting</span>}

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden -space-x-2 sm:flex">
          {view.members.slice(0, 6).map((person) => (
            <Avatar key={person.userId} person={person} status={view.viewerStates[person.userId]} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => void share()}
          className="cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          {confirmed ? 'Link copied' : 'Invite'}
        </button>
      </div>
    </header>
  );
};
