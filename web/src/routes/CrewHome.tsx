import type { RoomPreview } from '../api/http';
import { JoinGate } from '../ui/JoinGate';

type Props = { slug: string; preview: RoomPreview; onJoin: (name: string, changed: boolean) => Promise<void> };

/** Track A's crew home. Any room with a crew lands here instead of the join gate. */
export default function CrewHome({ preview, onJoin }: Props) {
  return <JoinGate preview={preview} onJoin={onJoin} />;
}
