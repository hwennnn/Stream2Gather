import type { ComponentProps, MouseEvent } from 'react';
import type { RoomSession } from '../room/session';

type LeaveLinkProps = Omit<ComponentProps<'a'>, 'href' | 'onClick'> & {
  session: RoomSession;
  go?: (url: string) => void;
};

/** Every way out of a room goes through here, so a choice to go is never taken for a dropped signal. */
export const LeaveLink = ({ session, go = (url) => window.location.assign(url), ...props }: LeaveLinkProps) => {
  const leave = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    void session.leave().then(() => go('/'));
  };
  return <a href="/" onClick={leave} {...props} />;
};
