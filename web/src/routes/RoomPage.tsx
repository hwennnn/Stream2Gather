import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, ApiError, type RoomPreview } from '../api/http';
import { RoomSession } from '../room/session';
import { track } from '../room/telemetry';
import { ChatPanel } from '../ui/ChatPanel';
import { JoinGate } from '../ui/JoinGate';
import { PeoplePanel } from '../ui/PeoplePanel';
import { PlayerStage } from '../ui/PlayerStage';
import { QueuePanel } from '../ui/QueuePanel';
import { RoomHeader } from '../ui/RoomHeader';

type Tab = 'chat' | 'queue' | 'people';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'queue', label: 'Queue' },
  { id: 'people', label: 'People' },
];

const arrivedJoined = () =>
  (window.history.state as { joined?: boolean } | null)?.joined === true;

const arrivedCopied = () =>
  (window.history.state as { copied?: boolean } | null)?.copied === true;

export const RoomPage = ({ slug }: { slug: string }) => {
  const [joined, setJoined] = useState(arrivedJoined);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (joined) return;
    api.preview(slug).then(setPreview, (error: unknown) =>
      setProblem(error instanceof ApiError ? error.message : 'Could not reach the server. Try again.'),
    );
  }, [joined, slug]);

  if (!joined) {
    return <JoinGate preview={preview} problem={problem} onJoin={() => setJoined(true)} />;
  }
  return <Room slug={slug} copied={arrivedCopied()} />;
};

const Room = ({ slug, copied }: { slug: string; copied: boolean }) => {
  const session = useMemo(() => new RoomSession(slug), [slug]);
  const view = useSyncExternalStore(session.subscribe, session.getView);
  const [tab, setTab] = useState<Tab>('chat');

  useEffect(() => {
    void session.connect();
    return () => session.close();
  }, [session]);

  useEffect(() => {
    if (view.connection === 'live' && session.marks.joinMs !== undefined) {
      track({ name: 'join_ms', value: session.marks.joinMs, room: slug });
    }
  }, [session, slug, view.connection]);

  if (view.connection === 'failed') {
    return (
      <main className="glow flex h-full items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">We couldn’t open this room</h1>
          <p className="mt-2 text-muted">{view.failure}</p>
          <a href="/" className="mt-6 inline-block text-accent underline-offset-4 hover:underline">
            Start a new room
          </a>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-ink">
      <RoomHeader slug={slug} view={view} copied={copied} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-none overflow-y-auto lg:flex-1">
          <PlayerStage session={session} view={view} />
        </main>

        <aside className="flex min-h-0 flex-1 flex-col border-line lg:w-[380px] lg:flex-none lg:border-l">
          <div role="tablist" aria-label="Room panels" className="flex gap-1 border-b border-line p-2">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === id ? 'bg-raised text-text' : 'text-muted hover:text-text'
                }`}
              >
                {label}
                {id === 'queue' && view.queue.length > 1 ? ` ${view.queue.length - 1}` : ''}
                {id === 'people' ? ` ${view.members.length}` : ''}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {tab === 'chat' && <ChatPanel session={session} view={view} />}
            {tab === 'queue' && <QueuePanel session={session} view={view} />}
            {tab === 'people' && <PeoplePanel session={session} view={view} />}
          </div>
        </aside>
      </div>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4">
        {view.notices.map((notice) => (
          <p key={notice.id} className="enter pointer-events-auto max-w-lg rounded-xl border border-line bg-raised px-4 py-2.5 text-sm shadow-xl">
            {notice.text}{' '}
            {notice.url && (
              <a href={notice.url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                Open on YouTube
              </a>
            )}
          </p>
        ))}
      </div>
    </div>
  );
};
