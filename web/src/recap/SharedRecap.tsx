import { useEffect } from 'react';

/** Track A's public recap page. Until it exists this link goes home, as it always has. */
export default function SharedRecap(_: { token: string }) {
  useEffect(() => window.location.replace('/'), []);
  return null;
}
