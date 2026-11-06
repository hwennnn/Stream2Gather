import { useEffect, useState } from 'react';
import type { RoomSession, RoomView } from '../room/session';
import { onCrew } from '../ui/rules';
import { crewApi, inviteLink } from './api';

/** Members hand out the link that joins the crew. Everyone else hands out the room. */
export const useInviteUrl = (session: RoomSession, view: RoomView): string => {
  const { slug } = session;
  const member = onCrew(view);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!member) {
      setToken(null);
      return undefined;
    }
    const load = () => {
      crewApi.home(slug).then(
        (home) => setToken(home.inviteToken),
        () => {}, // The room link still works.
      );
    };
    load();
    return session.onCrew((changed) => {
      if (changed !== 'watchlist') load();
    });
  }, [member, session, slug]);

  return token ? inviteLink(slug, token) : `${window.location.origin}/r/${slug}`;
};
