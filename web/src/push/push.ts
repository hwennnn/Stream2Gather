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

const save = async (current: PushSubscription, claim: boolean) => {
  const { endpoint, keys } = current.toJSON();
  const { id } = await post<{ id: string }>('/v1/push/subscriptions', claim ? { endpoint, keys, claim } : { endpoint, keys });
  localStorage.setItem(THIS_DEVICE, id);
};

const keyBytes = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

/**
 * Call straight from a click: Safari refuses a permission request made any later.
 * The worker registers here and nowhere else, so first load doesn't change.
 * This is the only claim on a browser, and it starts from a fresh endpoint, so
 * nothing someone else set up here carries over.
 */
export const turnOn = async (publicKey: string): Promise<PushState> => {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  await (await registration.pushManager.getSubscription())?.unsubscribe().catch(() => {});
  const created = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await save(created, true);
  return 'on';
};

/**
 * For a page load, so it never claims anything. A subscription this person doesn't
 * hold was signed out elsewhere or is someone else's: letting go stops their pings
 * showing here, and Allow is how this person gets their own. Any other failure says
 * nothing about whose it is, so the card keeps saying what the browser says.
 */
export const keepThisDevice = async (): Promise<PushState> => {
  const current = await subscription();
  if (!current) return 'off';
  try {
    await save(current, false);
  } catch (error) {
    if ((error as { code?: string }).code !== 'not_yours') return 'on';
    localStorage.removeItem(THIS_DEVICE);
    await current.unsubscribe().catch(() => {});
    return 'off';
  }
  return 'on';
};

/** A browser that signed out holds no subscription. Others are ended by the server. */
export const stopPings = async () => {
  localStorage.removeItem(THIS_DEVICE);
  await (await subscription())?.unsubscribe();
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
