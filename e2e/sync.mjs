// Puts real browsers in one room and measures how far apart their videos are.
// Needs the server running with ALLOW_DIRECT_MEDIA=true, and sample.mp4 in the
// web build. Run: node sync.mjs [output-dir]
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:18080';
const OUT = process.argv[2] ?? '.';
const YOUTUBE_OK = process.env.YOUTUBE_OK ?? 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const YOUTUBE_BLOCKED = process.env.YOUTUBE_BLOCKED ?? '';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const report = {};
const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}  ${detail}`);
};

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
};

const viewer = async (name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await context.newPage();
  // Offline mode leaves open WebSockets alone, so tests need a way to cut one.
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        window.__sockets.push(this);
      }
    };
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 200)));
  return { name, context, page, errors };
};

const createRoom = async (host, url) => {
  await host.page.goto(BASE);
  await host.page.fill('#link', url);
  const started = Date.now();
  await host.page.click('button[type=submit]');
  await host.page.waitForURL(/\/r\//);
  const createMs = Date.now() - started;
  return { url: host.page.url(), createMs };
};

const join = async (guest, url) => {
  await guest.page.goto(url);
  await guest.page.getByRole('button', { name: 'Join' }).click();
};

const sampleAll = (viewers) =>
  Promise.all(viewers.map((v) => v.page.evaluate(() => window.__s2g?.sample() ?? null)));

/** Reads every viewer at one instant of server time, then compares positions. */
const pairwiseDrift = (samples) => {
  const live = samples.filter(Boolean);
  const aligned = live.map((s) => s.time - s.expected);
  let worst = 0;
  for (const a of aligned) for (const b of aligned) worst = Math.max(worst, Math.abs(a - b));
  return worst;
};

const measure = async (viewers, seconds) => {
  const drifts = [];
  for (let i = 0; i < seconds; i += 1) {
    await sleep(1000);
    const samples = await sampleAll(viewers);
    if (samples.every((s) => s && s.state === 'playing')) drifts.push(pairwiseDrift(samples) * 1000);
  }
  return { n: drifts.length, p50: Math.round(percentile(drifts, 0.5)), p95: Math.round(percentile(drifts, 0.95)), max: Math.round(percentile(drifts, 1)) };
};

const waitPlaying = async (viewers, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const samples = await sampleAll(viewers);
    if (samples.every((s) => s?.state === 'playing' && s.time > 0)) return true;
    await sleep(200);
  }
  return false;
};

// Direct file: the tightest case, and it needs no third party.
{
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(viewer));
  const room = await createRoom(a, `${BASE}/sample.mp4`);
  report.createRoomMs = room.createMs;
  const copied = await a.page.evaluate(() => navigator.clipboard.readText());
  check('link copied on create', copied === room.url, copied);

  await join(b, room.url);
  check('both start', await waitPlaying([a, b]), '');

  report.mp4Steady = await measure([a, b], 12);
  check('steady drift under 80ms p95', report.mp4Steady.p95 < 80, JSON.stringify(report.mp4Steady));

  await join(c, room.url);
  check('late joiner plays', await waitPlaying([a, b, c]), '');
  await sleep(4000);
  report.mp4LateJoin = await measure([a, b, c], 8);
  check('late joiner in sync', report.mp4LateJoin.p95 < 150, JSON.stringify(report.mp4LateJoin));

  // One viewer pauses through the player; everyone must follow.
  await b.page.evaluate(() => document.querySelector('video').pause());
  await sleep(900);
  const paused = await sampleAll([a, b, c]);
  check('pause reaches everyone', paused.every((s) => s.state === 'paused'), paused.map((s) => s.state).join());

  await a.page.evaluate(() => document.querySelector('video').play());
  await sleep(2500);
  const resumed = await sampleAll([a, b, c]);
  check('resume reaches everyone', resumed.every((s) => s.state === 'playing'), resumed.map((s) => s.state).join());

  // A seek through the native controls moves the whole room.
  const before = (await sampleAll([a]))[0].time;
  await c.page.evaluate((to) => { document.querySelector('video').currentTime = to; }, before + 20);
  const seekStarted = Date.now();
  let converged = null;
  while (Date.now() - seekStarted < 6000) {
    await sleep(200);
    const samples = await sampleAll([a, b, c]);
    if (samples.every((s) => s.time > before + 15) && pairwiseDrift(samples) < 0.25) {
      converged = Date.now() - seekStarted;
      break;
    }
  }
  report.seekConvergeMs = converged;
  check('seek converges under 2.5s', converged !== null && converged < 2500, String(converged));

  // Chat and queue through the UI.
  await a.page.getByRole('textbox', { name: 'Message' }).fill('hello room');
  await a.page.keyboard.press('Enter');
  await b.page.getByText('hello room').waitFor({ timeout: 3000 });
  check('chat delivered', true, '');

  // The measurement must be able to see drift, or the numbers above mean nothing.
  await sleep(1500);
  const clean = pairwiseDrift(await sampleAll([a, b, c]));
  await b.page.evaluate(() => { document.querySelector('video').currentTime += 0.6; });
  await sleep(150);
  const injected = pairwiseDrift(await sampleAll([a, b, c]));
  check('measurement sees injected drift', injected > 0.4 && injected < 0.8, `before ${Math.round(clean * 1000)}ms, after ${Math.round(injected * 1000)}ms`);

  const injectedAt = Date.now();
  let healed = null;
  while (Date.now() - injectedAt < 20000) {
    await sleep(250);
    if (pairwiseDrift(await sampleAll([a, b, c])) < 0.15) {
      healed = Date.now() - injectedAt;
      break;
    }
  }
  report.driftHealMs = healed;
  check('injected drift corrects itself', healed !== null, String(healed));

  // A dropped connection must come back on the timeline.
  const cutAt = Date.now();
  await b.page.evaluate(() => window.__sockets.at(-1).close());
  await b.page.getByText('Reconnecting').waitFor({ state: 'visible', timeout: 2000 });
  await b.page.getByText('Reconnecting').waitFor({ state: 'hidden', timeout: 10000 });
  report.reconnectMs = Date.now() - cutAt;
  check('reconnects under 3s', report.reconnectMs < 3000, String(report.reconnectMs));
  await sleep(2000);
  const afterReconnect = pairwiseDrift(await sampleAll([a, b, c]));
  check('in sync after reconnect', afterReconnect < 0.15, `${Math.round(afterReconnect * 1000)}ms`);

  await a.page.screenshot({ path: `${OUT}/room-mp4.png` });
  report.mp4Errors = [...new Set([...a.errors, ...b.errors, ...c.errors])].slice(0, 5);
  await Promise.all([a, b, c].map((v) => v.context.close()));
}

// Real YouTube through the official player.
{
  const [a, b] = await Promise.all(['a', 'b'].map(viewer));
  const room = await createRoom(a, YOUTUBE_OK);
  await join(b, room.url);
  const started = await waitPlaying([a, b], 25000);
  check('youtube plays for both', started, '');
  if (started) {
    await sleep(5000);
    report.youtubeSteady = await measure([a, b], 20);
    check('youtube drift under 400ms p95', report.youtubeSteady.p95 < 400, JSON.stringify(report.youtubeSteady));
  }
  await a.page.screenshot({ path: `${OUT}/room-youtube.png` });
  report.youtubeErrors = [...new Set([...a.errors, ...b.errors])].slice(0, 5);
  await Promise.all([a, b].map((v) => v.context.close()));
}

// A video whose owner blocks embedding must not break the room.
if (YOUTUBE_BLOCKED) {
  const a = await viewer('a');
  await createRoom(a, YOUTUBE_BLOCKED);
  await a.page.getByText(/Skipped/).waitFor({ timeout: 15000 });
  check('blocked video is skipped with a notice', true, '');
  await a.page.screenshot({ path: `${OUT}/room-blocked.png` });
  await a.context.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
