import { useCallback, useEffect, useState } from 'react';
import { ApiError, type RoomPreview } from '../api/http';
import { account, useAccount } from '../auth/account';
import { JoinGate } from '../ui/JoinGate';
import { crewApi, WANTS_JOIN } from './api';

const inviteToken = () => new URLSearchParams(window.location.search).get('join');

type Props = {
  slug: string;
  preview: RoomPreview;
  onJoin: (name: string, changed: boolean) => Promise<void>;
  /** The roster has changed, so the page should ask who this is again. */
  onJoined: () => void;
};

/** What someone who isn't on the crew sees: a seat if they can have one, and what the crew keeps for itself. */
export const CrewGate = ({ slug, preview, onJoin, onJoined }: Props) => {
  const { user, publishableKey } = useAccount();
  const signedIn = Boolean(user?.signedIn);
  const [token] = useState(inviteToken);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const crew = preview.crew;

  const joinCrew = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setProblem(null);
    try {
      await crewApi.join(slug, token);
      window.history.replaceState(window.history.state, '', window.location.pathname);
      onJoined();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'That didn’t work. Try again.');
      setBusy(false);
    }
  }, [onJoined, slug, token]);

  // Someone who had to sign in first carries on without asking twice.
  useEffect(() => {
    if (!signedIn || sessionStorage.getItem(WANTS_JOIN) !== slug) return;
    sessionStorage.removeItem(WANTS_JOIN);
    void joinCrew();
  }, [joinCrew, signedIn, slug]);

  const start = () => {
    if (signedIn) {
      void joinCrew();
      return;
    }
    sessionStorage.setItem(WANTS_JOIN, slug);
    account.signIn();
  };

  const canJoinCrew = token !== null && problem === null && (signedIn || publishableKey !== '');
  const canVisit = crew?.guestAccess !== false;
  const joinCrewLabel = busy ? 'Joining…' : 'Join the crew';
  const aside = (
    <div className="mt-3">
      {problem && (
        <p role="alert" className="mb-3 text-sm text-warn">
          {problem}
        </p>
      )}
      {canVisit ? (
        <p className="text-sm text-muted">
          You can watch, chat and react tonight. The watchlist and past nights stay with the crew.{' '}
          {canJoinCrew && (
            <button type="button" disabled={busy} onClick={start} className="cursor-pointer text-text underline underline-offset-2">
              {joinCrewLabel}
            </button>
          )}
        </p>
      ) : canJoinCrew ? (
        <button type="button" disabled={busy} onClick={start} className="btn btn-primary w-full">
          {joinCrewLabel}
        </button>
      ) : (
        <p className="text-sm text-muted">This room is for its crew. Ask them for an invite.</p>
      )}
    </div>
  );

  return <JoinGate preview={preview} onJoin={onJoin} heading={canVisit ? undefined : preview.name} crew aside={aside} canJoin={canVisit} />;
};
