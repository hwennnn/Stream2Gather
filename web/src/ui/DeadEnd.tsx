import { useState } from 'react';
import { startRoom } from '../routes/router';
import { Page } from './Page';

export type Ending = { title: string; body: string };

export const ENDINGS = {
  missing: { title: 'This room doesn’t exist.', body: 'The link may be wrong. Check it with whoever sent it.' },
  closed: { title: 'This room’s night is over.', body: 'Start a new one and send the link round.' },
  unreachable: { title: 'Can’t reach this room.', body: 'Check your connection, then try again.' },
} as const;

export const fullRoom = (members: number, limit: number): Ending => ({
  title: 'This room is full.',
  body: `${members} of ${limit} people are in. Ask the host to open a new room.`,
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
    <Page>
      <ul aria-hidden="true" data-gate="true" className="seats mb-6">
        {[0, 1, 2, 3].map((seat) => (
          <li key={seat} className="seat">
            <span className="seat-empty" />
          </li>
        ))}
      </ul>
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em] text-balance">{title}</h1>
      <p className="mt-1.5 text-muted">{body}</p>
      <div className="mt-5 flex flex-wrap gap-2">
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
        <p role="alert" className="mt-3 text-[13px] text-bad">
          {problem}
        </p>
      )}
    </Page>
  );
};
