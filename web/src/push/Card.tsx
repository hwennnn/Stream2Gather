import { useEffect, useState } from 'react';
import { api } from '../api/http';
import {
  deviceName, isThisDevice, readPushState, readSettings, removeDevice, setCrewPings, turnOn,
  type PushCrew, type PushDevice, type PushState,
} from './push';

const FAILED = 'That didn’t work. Try again.';

const Settings = ({ slug, onChanged }: { slug: string; onChanged: () => void }) => {
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [crew, setCrew] = useState<PushCrew | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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
  }, [slug]);

  const toggle = async (on: boolean) => {
    const notify = on ? 'all' : 'off';
    setProblem(null);
    await setCrewPings(slug, notify).then(() => setCrew((current) => current && { ...current, notify }), () => setProblem(FAILED));
  };

  const remove = async (id: string) => {
    setProblem(null);
    await removeDevice(id).then(() => {
      onChanged();
      return load();
    }, () => setProblem(FAILED));
  };

  return (
    <div className="mt-3">
      {crew && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={crew.notify === 'all'} onChange={(event) => void toggle(event.target.checked)} />
          Ping me about this crew
        </label>
      )}
      {devices?.length === 0 && <p className="mt-3 text-sm text-muted">No devices yet.</p>}
      {devices && devices.length > 0 && (
        <ul aria-label="Devices" className="mt-3 divide-y divide-line border-y border-line">
          {devices.map((device) => (
            <li key={device.id} className="flex h-11 items-center gap-3 text-sm">
              <span className="min-w-0 truncate">
                {deviceName(device.userAgent)}
                {isThisDevice(device.id) && <span className="text-muted"> (this one)</span>}
              </span>
              <button type="button" onClick={() => void remove(device.id)} className="btn btn-ghost ml-auto">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="status" className="mt-2 text-sm text-warn">
          {problem}
        </p>
      )}
    </div>
  );
};

/** Offers pings on a crew home. It asks the browser only when someone presses Allow. */
export default function Card({ slug }: { slug: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => void readPushState().then(setState, () => setState('unsupported'));

  useEffect(() => {
    refresh();
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
    <section aria-label="Pings" className="mt-6">
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
      {state !== 'install' && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted">Devices and settings</summary>
          <Settings slug={slug} onChanged={refresh} />
        </details>
      )}
    </section>
  );
}
