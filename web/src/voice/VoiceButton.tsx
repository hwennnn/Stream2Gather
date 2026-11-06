import type { PlayerAdapter } from '../players/types';
import type { RoomSession, RoomView } from '../room/session';

type Props = { session: RoomSession; view: RoomView; adapter: () => PlayerAdapter | null };

/** Track B's voice button, in the room header. */
export default function VoiceButton(_: Props) {
  return null;
}
