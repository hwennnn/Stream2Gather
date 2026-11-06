import { useSyncExternalStore } from 'react';
import { useAccount } from '../auth/account';
import type { PlayerAdapter } from '../players/types';
import type { RoomSession, RoomView } from '../room/session';
import { useMediaQuery } from '../ui/useMediaQuery';

// Everything LiveKit lives behind this import, so the button itself costs almost nothing.
const load = () => import('./live');

type Live = Awaited<ReturnType<typeof load>>;
type Active = { live: Live; call: InstanceType<Live['VoiceCall']> };
type HostView = {
  active: Active | null;
  joining: boolean;
  /** Why the last call ended or never started. */
  note: string | null;
};

/**
 * Owns a room's call. It outlives the button because the button doesn't last: the
 * header goes away in fullscreen and an upright phone moves it under the player.
 */
class VoiceHost {
  private view: HostView = { active: null, joining: false, note: null };
  private readonly listeners = new Set<() => void>();
  adapter: () => PlayerAdapter | null = () => null;

  constructor(private readonly session: RoomSession) {
    session.onClosing(() => this.view.active?.call.leave());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  private update(next: Partial<HostView>): void {
    this.view = { ...this.view, ...next };
    for (const listener of this.listeners) listener();
  }

  async join(): Promise<void> {
    const { session } = this;
    this.update({ joining: true, note: null });
    try {
      const live = await load();
      const call = new live.VoiceCall({
        slug: session.slug,
        player: () => this.adapter(),
        source: () => session.getView().queue[0]?.source,
        report: (state) => session.setVoice(state),
        speakers: (userIds) => session.setSpeaking(userIds),
        say: (text) => session.tell(text),
        onEnd: (note) => this.update({ active: null, note }),
      });
      this.update({ active: { live, call } });
      await call.join();
    } catch {
      this.update({ note: 'Voice unavailable' });
    } finally {
      this.update({ joining: false });
    }
  }
}

const hosts = new WeakMap<RoomSession, VoiceHost>();

const hostFor = (session: RoomSession): VoiceHost => {
  const host = hosts.get(session) ?? new VoiceHost(session);
  hosts.set(session, host);
  return host;
};

const MicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true" className="size-4">
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </svg>
);

type Props = {
  session: RoomSession;
  view: RoomView;
  adapter: () => PlayerAdapter | null;
  /** The header, or the bar an upright phone has under the player. */
  place?: 'header' | 'bar';
};

/** The room header's way into the call, and the controls once in it. */
export default function VoiceButton({ session, view, adapter, place = 'header' }: Props) {
  const { config } = useAccount();
  const upright = useMediaQuery('(max-width: 639px) and (orientation: portrait)');
  const host = hostFor(session);
  const { active, joining, note } = useSyncExternalStore(host.subscribe, host.getView);
  host.adapter = adapter;

  if (!config?.voice || upright !== (place === 'bar')) return null;

  const others = view.members.filter((person) => person.voice && person.userId !== view.self?.userId);
  if (active) return <active.live.VoicePanel call={active.call} alone={others.length === 0} />;

  const invitation = others[0] ? `${others[0].name} is in voice. Join` : 'Join voice';
  const preload = () => void load().catch(() => {});
  return (
    <button
      type="button"
      disabled={joining}
      onClick={() => void host.join()}
      onPointerEnter={preload}
      onPointerDown={preload}
      onFocus={preload}
      className="btn btn-quiet btn-sm"
    >
      <MicIcon />
      {joining ? 'Joining voice…' : (note ?? invitation)}
    </button>
  );
}

/** Shown in the People tab while this tab is in the call. */
export const VoiceSettingsSlot = ({ session }: { session: RoomSession }) => {
  const host = hostFor(session);
  const { active } = useSyncExternalStore(host.subscribe, host.getView);
  return active && <active.live.VoiceSettings call={active.call} />;
};
