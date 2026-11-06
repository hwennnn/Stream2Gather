import { useEffect, useState } from 'react';
import { api } from '../api/http';
import {
  deviceName, isThisDevice, keepThisDevice, readPushState, readSettings, removeDevice, setCrewPings, turnOn,
  type PushCrew, type PushDevice, type PushState,
} from './push';

const FAILED = 'That didn’t work. Try again.';

/** What pings do for this crew and which devices get them. Lives with the crew's settings. */
export const PushSettings = ({ slug }: { slug: string }) => {
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [crew, setCrew] = useState<PushCrew | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [offered, setOffered] = useState(false);

  const load = () =>
    readSettings().then(
      (settings) => {
        setDevices(settings.devices);
        setCrew(settings.crews.find((entry) => entry.slug === slug) ?? null);
      },
      () => setProblem(FAILED),
    );

  useEffect(() => {
    void load();
    // A browser that can't get pings has nothing to set here.
    void Promise.all([readPushState(), api.config()]).then(
      ([state, config]) => setOffered(state !== 'unsupported' && state !== 'install' && Boolean(config.vapidPublicKey)),
      () => setOffered(false),
    );
  }, [slug]);

  const toggle = async (on: boolean) => {
    const notify = on ? 'all' : 'off';
    setProblem(null);
    await setCrewPings(slug, notify).then(() => setCrew((current) => current && { ...current, notify }), () => setProblem(FAILED));
  };

  const remove = async (id: string) => {
    setProblem(null);
    await removeDevice(id).then(load, () => setProblem(FAILED));
  };

  if (!offered || (!devices && !problem)) return null;

  return (
    <section aria-label="Pings" className="mt-8">
      <h2 className="text-sm font-semibold">Pings</h2>
      <div className="mt-2 divide-y divide-line border-y border-line text-sm">
        {crew && (
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-1">
            Ping me about this crew
            <input type="checkbox" checked={crew.notify === 'all'} onChange={(event) => void toggle(event.target.checked)} className="size-4 accent-primary" />
          </label>
        )}
        {devices?.length === 0 && <p className="flex min-h-11 items-center py-1 text-dim">No devices yet.</p>}
        {devices?.map((device) => (
          <div key={device.id} className="flex min-h-11 items-center gap-3 py-1">
            <span className="min-w-0 truncate">
              {deviceName(device.userAgent)}
              {isThisDevice(device.id) && <span className="text-dim"> (this one)</span>}
            </span>
            <button type="button" onClick={() => void remove(device.id)} className="btn btn-ghost btn-sm -mr-2.5 ml-auto text-text">
              Stop pings
            </button>
          </div>
        ))}
      </div>
      {problem && (
        <p role="status" className="mt-2 text-sm text-warn">
          {problem}
        </p>
      )}
    </section>
  );
};

/** Offers pings on a crew home. It asks the browser only when someone presses Allow. */
export default function Card() {
  const [state, setState] = useState<PushState | null>(null);
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    // Failing costs nothing: the card says what the browser says, as it always has.
    void readPushState().then(async (found) => setState(found === 'on' ? await keepThisDevice() : found), () => setState('unsupported'));
    api.config().then((config) => setPublicKey(config.vapidPublicKey), () => setPublicKey(''));
  }, []);

  const allow = async () => {
    setBusy(true);
    setProblem(null);
    await turnOn(publicKey).then(setState, () => setProblem(FAILED));
    setBusy(false);
  };

  if (!state || state === 'unsupported' || !publicKey) return null;

  return (
    <section aria-label="Pings" className="mt-3 border-t border-line pt-3">
      {state === 'off' && (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted">Get a ping when your crew starts watching.</p>
          <button type="button" disabled={busy} onClick={() => void allow()} className="btn btn-quiet shrink-0">
            Allow
          </button>
        </div>
      )}
      {state === 'on' && <p className="text-sm text-muted">You’re on. We’ll ping this device.</p>}
      {state === 'denied' && (
        <p className="text-sm text-muted">
          Notifications are blocked for this site. To get pings, allow them in your browser’s site settings.
        </p>
      )}
      {state === 'install' && (
        <p className="text-sm text-muted">
          Add Stream2Gather to your Home Screen to get pings. Tap Share, then Add to Home Screen, and open it from there.
        </p>
      )}
      {problem && (
        <p role="status" className="mt-2 text-sm text-warn">
          {problem}
        </p>
      )}
    </section>
  );
}
