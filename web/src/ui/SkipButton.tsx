import { useState } from 'react';
import type { RoomSession, RoomView } from '../room/session';
import { isOffline } from './rules';
import { toastError } from './Toasts';

export const SkipButton = ({ session, view, onToast, className = '' }: { session: RoomSession; view: RoomView; onToast: (text: string) => void; className?: string }) => {
  const [busy, setBusy] = useState(false);
  const next = view.queue[1];
  const skip = async () => {
    setBusy(true);
    try {
      // A jump to the next video can be undone for a few seconds. Ending the last one can't.
      if (next) await session.request('queue.play', { target: next.id });
      else await session.request('skip', { item: view.playback.item });
    } catch (error) {
      toastError(onToast)(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={busy || isOffline(view)} onClick={() => void skip()} className={`btn btn-quiet ${className}`}>
      {next ? 'Skip' : 'Finish video'}
    </button>
  );
};
