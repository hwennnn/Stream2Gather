import { post, request } from '../api/http';

/** `install` is an iPhone in a Safari tab, where web push doesn't exist yet. */
export type PushState = 'off' | 'on' | 'denied' | 'install' | 'unsupported';

export type PushDevice = { id: string; userAgent: string; createdAt: string; lastOkAt: string | null };
export type PushCrew = { slug: string; name: string; notify: 'all' | 'off' };

/** Which device is this one, since the server never sends endpoints back. */
const THIS_DEVICE = 's2g:push-device';

const iPhoneTab = () => {
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return apple && !window.matchMedia('(display-mode: standalone)').matches;
};

const subscription = async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
};

/** Reads without asking anything, so it's safe on page load. */
export const readPushState = async (): Promise<PushState> => {
  if (iPhoneTab()) return 'install';
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && (await subscription()) ? 'on' : 'off';
};

const keyBytes = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

/**
 * Call straight from a click: Safari refuses a permission request made any later.
 * The worker registers here and nowhere else, so first load doesn't change.
 */
export const turnOn = async (publicKey: string): Promise<PushState> => {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const created = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const { endpoint, keys } = created.toJSON();
  const { id } = await post<{ id: string }>('/v1/push/subscriptions', { endpoint, keys });
  localStorage.setItem(THIS_DEVICE, id);
  return 'on';
};

export const isThisDevice = (id: string) => localStorage.getItem(THIS_DEVICE) === id;

/** Forgetting this browser also unsubscribes it, or it would still look turned on. */
export const removeDevice = async (id: string) => {
  await request<unknown>(`/v1/push/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!isThisDevice(id)) return;
  localStorage.removeItem(THIS_DEVICE);
  await (await subscription())?.unsubscribe();
};

export const readSettings = () => request<{ devices: PushDevice[]; crews: PushCrew[] }>('/v1/me/notifications');

export const setCrewPings = (slug: string, notify: PushCrew['notify']) =>
  request<unknown>(`/v1/crews/${encodeURIComponent(slug)}/me`, { method: 'PATCH', body: JSON.stringify({ notify }) });

const BROWSERS: [RegExp, string][] = [[/Edg\//, 'Edge'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']];
const SYSTEMS: [RegExp, string][] = [[/iPhone|iPad/, 'iPhone'], [/Android/, 'Android'], [/Mac OS/, 'Mac'], [/Windows/, 'Windows'], [/Linux/, 'Linux']];

export const deviceName = (userAgent: string) => {
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return browser && system ? `${browser} on ${system}` : (browser ?? system ?? 'A browser');
};
