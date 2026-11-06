import type { RoomPreview } from '../api/http';
import { MemberHome } from '../crew/MemberHome';
import { useCrew } from '../crew/useCrew';
import { JoinGate } from '../ui/JoinGate';

type Props = { slug: string; preview: RoomPreview; onJoin: (name: string, changed: boolean) => Promise<void> };

/** A room with a crew opens here: its home for members, and an invite for everyone else. */
export default function CrewHome({ slug, preview, onJoin }: Props) {
  const { home, settled, problem } = useCrew(slug);
  if (home) return <MemberHome slug={slug} home={home} problem={problem} onJoin={onJoin} />;
  if (!settled && preview.crew?.isMember) return <main className="h-full bg-ink" />;
  return <JoinGate preview={preview} onJoin={onJoin} />;
}
