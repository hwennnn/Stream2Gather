import type { RoomPreview } from '../api/http';
import { Avatar } from './Avatar';

type JoinGateProps = {
  preview: RoomPreview | null;
  problem: string | null;
  onJoin: () => void;
};

/** The Join click is also the gesture that lets the video start with sound. */
export const JoinGate = ({ preview, problem, onJoin }: JoinGateProps) => {
  if (problem) {
    return (
      <main className="glow flex h-full items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">{problem}</h1>
          <a href="/" className="mt-6 inline-block text-accent underline-offset-4 hover:underline">
            Start a new room
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="glow flex h-full items-center justify-center px-6">
      <div className="enter w-full max-w-md rounded-3xl border border-line bg-panel p-6">
        <div className="aspect-video overflow-hidden rounded-2xl bg-raised">
          {preview?.nowPlaying?.thumbnailUrl && (
            <img src={preview.nowPlaying.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <p className="mt-5 text-sm text-muted">{preview?.name ?? 'Loading room'}</p>
        <h1 className="mt-1 text-xl leading-snug font-semibold text-balance">
          {preview?.nowPlaying?.title ?? 'Join the watch party'}
        </h1>

        {preview && preview.members.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <div className="flex -space-x-2">
              {preview.members.slice(0, 5).map((person) => (
                <Avatar key={person.userId} person={person} />
              ))}
            </div>
            <span className="text-sm text-muted">
              {preview.members.length === 1 ? `${preview.members[0]?.name} is here` : `${preview.members.length} people are here`}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onJoin}
          autoFocus
          className="mt-6 w-full cursor-pointer rounded-xl bg-accent py-3 font-semibold text-ink transition hover:brightness-110"
        >
          Join
        </button>
      </div>
    </main>
  );
};
