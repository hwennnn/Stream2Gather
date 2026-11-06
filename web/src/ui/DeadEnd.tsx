import { useState } from 'react';
import { startRoom } from '../routes/router';

export type Ending = { title: string; body: string };

export const ENDINGS = {
  missing: { title: 'We can’t find this room.', body: 'Check the link with whoever sent it.' },
  closed: { title: 'This room has closed.', body: 'Start a new one to keep watching.' },
  unreachable: { title: 'Can’t reach this room', body: 'Check your connection, then try again.' },
} as const;

export const fullRoom = (members: number, limit: number): Ending => ({
  title: `This room is full (${members} of ${limit}).`,
  body: 'Ask the host to open a new room.',
});

/** Every way a room can be out of reach ends here, with a way forward. */
export const DeadEnd = ({ title, body, onRetry }: Ending & { onRetry?: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await startRoom();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <main className="glow flex h-full items-center justify-center px-6 text-center">
      <div className="enter max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="mt-2 text-muted">{body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn btn-primary">
              Try again
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void start()} className={`btn ${onRetry ? 'btn-quiet' : 'btn-primary'}`}>
            {busy ? 'Opening…' : 'Start a new room'}
          </button>
        </div>
        {problem && (
          <p role="alert" className="mt-3 text-sm text-warn">
            {problem}
          </p>
        )}
      </div>
    </main>
  );
};
