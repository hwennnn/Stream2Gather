import { useEffect } from 'react';

type Props = { slug: string; itemId: string };

/** Track A's catch-up page. Until it exists this link goes to the room, as it always has. */
export default function CatchupPage({ slug }: Props) {
  useEffect(() => window.location.replace(`/r/${slug}`), [slug]);
  return null;
}
