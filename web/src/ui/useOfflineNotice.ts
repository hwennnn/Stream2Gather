import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '../room/session';

const OFFLINE_BAR_DELAY_MS = 1000;

/** How long the bar has had reason to show, or null while it shouldn't. */
export const useOfflineNotice = (view: RoomView, onBack: () => void): number | null => {
  const [elapsed, setElapsed] = useState(0);
  const shown = useRef(false);
  const since = view.offlineSince;

  useEffect(() => {
    if (since === null) {
      setElapsed(0);
      if (shown.current) onBack();
      shown.current = false;
      return undefined;
    }
    const tick = () => {
      const passed = Date.now() - since;
      setElapsed(passed);
      if (passed >= OFFLINE_BAR_DELAY_MS) shown.current = true;
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [since, onBack]);

  return since !== null && elapsed >= OFFLINE_BAR_DELAY_MS ? elapsed : null;
};
