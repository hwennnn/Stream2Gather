import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import { useAccount } from '../auth/account';
import { usePageVisible } from '../ui/usePageVisible';
import { crewApi, type CrewDocument } from './api';

const POLL_MS = 30_000;

export type Crew = {
  /** Null until the page knows, and whenever this person isn't on the crew. */
  home: CrewDocument | null;
  /** True once the server has said whether this person is on the crew. */
  settled: boolean;
  problem: string | null;
  refresh: () => void;
};

/** Reads the crew home for as long as it's on screen. Only the server knows who's on the roster. */
export const useCrew = (slug: string): Crew => {
  const { user } = useAccount();
  const signedIn = Boolean(user?.signedIn);
  const visible = usePageVisible();
  const [home, setHome] = useState<CrewDocument | null>(null);
  const [settled, setSettled] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const run = (latest.current += 1);
    crewApi.home(slug).then(
      (next) => {
        if (run !== latest.current) return;
        setHome(next);
        setProblem(null);
        setSettled(true);
      },
      (error: unknown) => {
        if (run !== latest.current) return;
        const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
        if (refused) setHome(null);
        else setProblem('We couldn’t refresh this page. It may be out of date.');
        setSettled(true);
      },
    );
  }, [slug]);

  useEffect(() => {
    if (!signedIn) {
      setHome(null);
      setSettled(true);
      return undefined;
    }
    if (!visible) return undefined;
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, signedIn, visible, user?.id]);

  return { home, settled, problem, refresh };
};
