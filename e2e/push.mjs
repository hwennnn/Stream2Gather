// Runs web push end to end against a fake push service: a real server, real Temporal,
// the real notifier, and a crew room that really plays. Nothing leaves this machine.
// `make e2e-push` builds what this needs. By hand, from e2e/:
//   BASE            the server under test
//   E2E_NOTIFIER    the s2g binary. This starts and kills it
//   E2E_SERVER_DIR  where to run it and mint-account from, for .env.local
//   E2E_MINT        the mint-account binary
//   E2E_PUSH_PORT   port for the fake push service (18091)
//   E2E_SESSIONS    how many crews to time (10)
//   E2E_PG          a Postgres container, to replay a finished outbox row. Skipped without one
import { execFileSync, spawn } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:18082';
const NOTIFIER = process.env.E2E_NOTIFIER;
const DIR = process.env.E2E_SERVER_DIR ?? '../server';
const MINT = process.env.E2E_MINT;
const PUSH_PORT = Number(process.env.E2E_PUSH_PORT ?? 18091);
const SESSIONS = Number(process.env.E2E_SESSIONS ?? 10);
const PG = process.env.E2E_PG;
// The spec's 60 seconds, and how long past the longest timer to wait for a repeat.
const TARGET_MS = 60_000;
const SETTLE_MS = 75_000;

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}  ${detail}`);
};
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? null;

const received = [];
const pushService = createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    received.push({ at: Date.now(), device: request.url.slice(1), headers: request.headers });
    response.writeHead(201).end();
  });
});

const mint = (name) => JSON.parse(execFileSync(MINT, [name], { cwd: DIR, encoding: 'utf8' }));

let address = 0;
const person = (name) => {
  const { id, cookie } = mint(name);
  const token = cookie;
  address += 1;
  const headers = { 'content-type': 'application/json', cookie: `s2g_session=${cookie}`, 'x-forwarded-for': `10.91.0.${address}` };
  const call = async (method, path, body) => {
    const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  };
  return { id, name, call, token };
};

const subscribe = async (who, device) => {
  const key = createECDH('prime256v1');
  key.generateKeys();
  await who.call('POST', '/v1/push/subscriptions', {
    claim: true,
    endpoint: `http://127.0.0.1:${PUSH_PORT}/${device}`,
    keys: { p256dh: key.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
  });
};

/** A crew of two: its host will press play, and its other member is away with a device. */
const crew = async (label) => {
  const host = person('Hana');
  const away = person('Bo');
  const { slug, inviteToken } = await host.call('POST', '/v1/crews', { name: label });
  await away.call('POST', `/v1/crews/${slug}/join`, { token: inviteToken });
  await subscribe(away, label);
  return { label, slug, host };
};

/** Joins the room and plays. The room opens its session on the first flush after this. */
const play = async ({ slug, host }) => {
  const { ticket } = await host.call('POST', `/v1/rooms/${slug}/ticket`, {});
  const socket = new WebSocket(`${BASE.replace('http', 'ws')}/v1/ws?ticket=${ticket}`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('socket failed'));
  });
  const pinger = setInterval(() => socket.send(JSON.stringify({ t: 'ping' })), 3000);
  socket.send(JSON.stringify({ t: 'queue.add', d: { url: `${BASE}/sample.mp4` }, id: 'add' }));
  return { at: Date.now(), close: () => { clearInterval(pinger); socket.close(); } };
};

let notifier = null;
const startNotifier = () => {
  notifier = spawn(NOTIFIER, ['notifier'], { cwd: DIR, stdio: ['ignore', 'ignore', 'inherit'] });
};
const killNotifier = async () => {
  const gone = new Promise((resolve) => { notifier.once('exit', resolve); });
  notifier.kill('SIGKILL');
  await gone;
};

const forDevice = (device) => received.filter((push) => push.device === device);

const timing = async () => {
  startNotifier();
  const crews = await Promise.all(Array.from({ length: SESSIONS }, (_, i) => crew(`timed-${i}`)));
  const rooms = await Promise.all(crews.map(play));
  await sleep(SETTLE_MS);
  const delays = crews.map(({ label }, i) => (forDevice(label)[0]?.at ?? Infinity) - rooms[i].at);
  rooms.forEach((room) => room.close());
  check('every absent member got exactly one', crews.every(({ label }) => forDevice(label).length === 1),
    crews.map(({ label }) => forDevice(label).length).join(','));
  const worst = p95(delays);
  check('push within 60 s of session start at p95', worst <= TARGET_MS, `p95 ${worst} ms, min ${Math.min(...delays)} ms, n ${delays.length}`);
  const sample = received[0];
  check('a push carries the spec headers', sample?.headers.ttl === '300' && sample?.headers.urgency === 'high' && sample?.headers.topic?.length === 32
    && sample?.headers['content-encoding'] === 'aes128gcm' && /^vapid t=/.test(sample?.headers.authorization ?? ''));
};

const surviving = async () => {
  const one = await crew('killed');
  const room = await play(one);
  await sleep(10_000);
  await killNotifier();
  check('nothing sent before the kill', forDevice('killed').length === 0, `${forDevice('killed').length}`);
  await sleep(2_000);
  startNotifier();
  await sleep(SETTLE_MS);
  room.close();
  check('killing the notifier in the timer gives exactly one', forDevice('killed').length === 1, `${forDevice('killed').length}`);
};

/** A real worker in real Chrome. Only the browser's own push service is stubbed, so nothing leaves here. */
const stubPushService = (endpoint) => {
  const fake = {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: window.__key, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } }),
    unsubscribe: async () => true,
  };
  PushManager.prototype.subscribe = async () => {
    localStorage.setItem('fake-push', 'yes');
    return fake;
  };
  PushManager.prototype.getSubscription = async () => (localStorage.getItem('fake-push') ? fake : null);
};

const inChrome = async () => {
  const key = createECDH('prime256v1');
  key.generateKeys();
  const mia = person('Mia');
  const { slug } = await mia.call('POST', '/v1/crews', { name: 'Chrome crew' });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    const { hostname, origin } = new URL(BASE);
    await context.addCookies([{ name: 's2g_session', value: mia.token, domain: hostname, path: '/' }]);
    await context.addInitScript(`window.__key = '${key.getPublicKey('base64url')}'`);
    await context.addInitScript(stubPushService, `http://127.0.0.1:${PUSH_PORT}/chrome`);
    const page = await context.newPage();
    const problems = [];
    page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${BASE}/r/${slug}`);
    const allow = page.getByRole('button', { name: 'Allow' });
    await allow.waitFor();
    const before = await page.evaluate(async () => [(await navigator.serviceWorker.getRegistrations()).length, Notification.permission]);
    check('page load registers nothing and asks nothing', before[0] === 0 && before[1] === 'default', before.join(' '));

    await context.grantPermissions(['notifications'], { origin });
    const worker = context.waitForEvent('serviceworker');
    await allow.click();
    await page.getByText('You’re on. We’ll ping this device.').waitFor();
    const { devices } = await mia.call('GET', '/v1/me/notifications');
    check('Allow saves this browser', devices.length === 1, `${devices.length}`);
    const sw = await worker;
    await page.reload();
    await page.getByText('You’re on. We’ll ping this device.').waitFor();
    check('a reload stays on', true);

    const cdp = await context.newCDPSession(page);
    const registered = new Promise((resolve) => { cdp.once('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => resolve(registrations[0].registrationId)); });
    await cdp.send('ServiceWorker.enable');
    const registrationId = await registered;
    const deliver = async (data) => {
      await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data });
      await sleep(500);
      return sw.evaluate(async () => {
        const shown = await self.registration.getNotifications();
        const last = shown.at(-1);
        return last ? { title: last.title, body: last.body, url: last.data.url, count: shown.length } : null;
      });
    };
    const payload = (navigate) => JSON.stringify({ web_push: 8030, notification: { title: 'Hana started watching in Chrome crew', body: 'Join in', navigate } });
    const shown = await deliver(payload(`/r/${slug}`));
    check('a push shows the notification', shown?.title === 'Hana started watching in Chrome crew' && shown?.body === 'Join in', JSON.stringify(shown));
    check('it points at the room', shown?.url === `${origin}/r/${slug}`, shown?.url);
    const unreadable = await deliver('not json');
    check('an unreadable push still shows something', unreadable?.title === 'Stream2Gather', JSON.stringify(unreadable));
    const elsewhere = await deliver(payload('https://example.test/phish'));
    check('a push cannot leave this site', elsewhere?.url === `${origin}/`, elsewhere?.url);

    const click = (url) => sw.evaluate(async (target) => {
      const shown = await self.registration.getNotifications();
      const notification = shown.find((one) => one.data.url === target);
      const opened = [];
      self.clients.openWindow = async (address) => { opened.push(address); return null; };
      const pending = [];
      const event = new NotificationEvent('notificationclick', { notification });
      event.waitUntil = (promise) => pending.push(promise);
      self.dispatchEvent(event);
      await Promise.allSettled(pending);
      return opened;
    }, url);
    check('tapping focuses the room already open', (await click(`${origin}/r/${slug}`)).length === 0);
    check('nothing complained in the console', problems.length === 0, problems.join(' | ').slice(0, 200));
    await page.goto(`${BASE}/`);
    await deliver(payload(`/r/${slug}`));
    const opened = await click(`${origin}/r/${slug}`);
    check('tapping opens the room when it is not open', opened[0] === `${origin}/r/${slug}`, opened.join(' '));
  } finally {
    await browser.close();
  }
};

/** What a crash between starting a workflow and marking its row done leaves behind. */
const replaying = async () => {
  if (!PG) return;
  const sql = (query) => execFileSync('docker', ['exec', PG, 'psql', '-q', '-U', 's2g', '-d', 's2g', '-Atc', query], { encoding: 'utf8' }).trim();
  const before = received.length;
  const rows = sql(`UPDATE outbox SET done_at = NULL, created_at = now() WHERE done_at > now() - interval '10 minutes' RETURNING id`);
  sql(`SELECT pg_notify('outbox', '')`);
  await sleep(SETTLE_MS);
  const open = sql('SELECT count(*) FROM outbox WHERE done_at IS NULL');
  check('a replayed row sends nothing new', received.length === before && open === '0',
    `replayed ${rows.split('\n').length}, new pushes ${received.length - before}, still open ${open}`);
};

await new Promise((resolve) => { pushService.listen(PUSH_PORT, '127.0.0.1', resolve); });
try {
  await inChrome();
  if (process.env.E2E_BROWSER_ONLY) process.exit(failures.length ? 1 : 0);
  await timing();
  await surviving();
  await replaying();
} finally {
  if (notifier) await killNotifier();
  pushService.close();
}
if (failures.length) {
  console.error(`\n${failures.length} failed\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nall passed');
