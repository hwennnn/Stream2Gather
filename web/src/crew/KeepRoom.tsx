import type { RoomSession, RoomView } from '../room/session';

/** Track A's "Keep this room", shown to the host in the room header. */
export default function KeepRoom(_: { session: RoomSession; view: RoomView }) {
  return null;
}
