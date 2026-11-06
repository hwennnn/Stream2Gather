import type { RoomPreview } from '../api/http';
import { CrewGate } from '../crew/CrewGate';
import { MemberHome } from '../crew/MemberHome';
import { useCrew } from '../crew/useCrew';

type Props = { slug: string; preview: RoomPreview; onJoin: (name: string, changed: boolean) => Promise<void> };

/** A room with a crew opens here: its home for members, and an invite for everyone else. */
export default function CrewHome({ slug, preview, onJoin }: Props) {
  const { home, settled, problem, refresh } = useCrew(slug);
  if (home) return <MemberHome slug={slug} home={home} problem={problem} refresh={refresh} onJoin={onJoin} />;
  if (!settled && preview.crew?.isMember) return <main className="h-full bg-ink" />;
  return <CrewGate slug={slug} preview={preview} onJoin={onJoin} onJoined={refresh} />;
}
