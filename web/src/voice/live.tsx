import { useSyncExternalStore } from 'react';
import type { VoiceCall } from './call';

export { VoiceCall } from './call';

type Status = { connecting: boolean; reconnecting: boolean; live: boolean; alone: boolean };

export const statusText = ({ connecting, reconnecting, live, alone }: Status): string => {
  if (connecting) return 'Joining voice…';
  if (reconnecting) return 'Reconnecting voice';
  if (live) return 'Mic on';
  return alone ? 'You’re the first one here. Others will see you in voice.' : 'You’re listening';
};

/** Where you are in the call, and the controls for it. */
export const VoicePanel = ({ call, alone }: { call: VoiceCall; alone: boolean }) => {
  const view = useSyncExternalStore(call.subscribe, call.getView);
  const live = view.mic === 'live';
  return (
    <div role="group" aria-label="Voice" className="flex min-w-0 items-center gap-2">
      <p role="status" className="line-clamp-2 max-w-56 text-[13px] leading-tight text-muted land:hidden">
        {statusText({ ...view, live, alone })}
      </p>
      {view.needsTap && (
        <button type="button" onClick={() => call.tapToHear()} className="btn btn-primary btn-sm">
          Tap to hear voice
        </button>
      )}
      {view.pushToTalk ? (
        <button
          type="button"
          aria-pressed={live}
          disabled={view.connecting}
          onPointerDown={() => call.holdToTalk(true)}
          onContextMenu={(event) => event.preventDefault()}
          className="btn btn-quiet btn-sm touch-none select-none"
        >
          Hold to talk
        </button>
      ) : (
        <button type="button" aria-pressed={live} disabled={view.connecting} onClick={() => call.toggleMic()} className="btn btn-quiet btn-sm">
          {live ? 'Mute' : 'Unmute'}
        </button>
      )}
      <button type="button" onClick={() => call.leave()} className="btn btn-ghost btn-sm">
        Leave voice
      </button>
    </div>
  );
};

type RowProps = { label: string; note?: string; on: boolean; onChange: (on: boolean) => void };

const SwitchRow = ({ label, note, on, onChange }: RowProps) => (
  <div className="flex items-center justify-between gap-4 border-t border-line p-4">
    <span className="text-sm leading-snug">
      {label}
      {note && <span className="mt-0.5 block text-xs text-muted">{note}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors ${on ? 'bg-primary' : 'bg-white/15'}`}
    >
      <span className={`absolute top-1 left-1 size-5 rounded-full shadow transition-transform ${on ? 'translate-x-5 bg-on-primary' : 'bg-white'}`} />
    </button>
  </div>
);

/** Lives in the People tab, so nothing has to open over the player. */
export const VoiceSettings = ({ call }: { call: VoiceCall }) => {
  const view = useSyncExternalStore(call.subscribe, call.getView);
  return (
    <div>
      <SwitchRow
        label="Push to talk"
        note="Hold the button or the V key. The key stops working while the video has focus."
        on={view.pushToTalk}
        onChange={(on) => call.setPushToTalk(on)}
      />
      <SwitchRow label="Lower the video while people talk" on={view.duck} onChange={(on) => call.setDucking(on)} />
    </div>
  );
};
