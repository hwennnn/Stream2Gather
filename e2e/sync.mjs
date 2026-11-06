// Puts real browsers in one room and measures how far apart their videos are.
// `make e2e` builds what this needs and runs it against a private server. To run
// it by hand, point BASE at a server with ALLOW_DIRECT_MEDIA=true and sample.mp4
// in its web build: BASE=http://127.0.0.1:18082 node sync.mjs [output-dir]
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:18082';
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

/** latencyMs delays each direction of the viewer's socket by that much. */
const viewer = async (name, { latencyMs = 0 } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await context.newPage();
  // Offline mode leaves open WebSockets alone, so tests need a way to cut one.
  // Browser network throttling doesn't reach them either, so latency goes here.
  await page.addInitScript((delay) => {
    const Native = window.WebSocket;
    window.__sockets = [];
    window.__roomEvents = 0;
    window.__sent = [];
    window.WebSocket = class extends Native {
      #onmessage = null;
      constructor(...args) {
        super(...args);
        window.__sockets.push(this);
        super.addEventListener('message', (event) => {
          if (/^\{"t":"(state|playback)"/.test(event.data)) window.__roomEvents += 1;
          if (delay === 0) this.#onmessage?.(event);
          else setTimeout(() => this.#onmessage?.(event), delay);
        });
      }
      get onmessage() {
        return this.#onmessage;
      }
      set onmessage(handler) {
        this.#onmessage = handler;
      }
      send(data) {
        window.__sent.push(JSON.parse(data).t);
        if (delay === 0) super.send(data);
        else setTimeout(() => this.readyState === Native.OPEN && super.send(data), delay);
      }
    };
  }, latencyMs);
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
  await host.page.waitForURL(/\/r\//, { timeout: 10000 }).catch(async () => {
    // Rooms are limited per address, so repeated runs can hit this.
    throw new Error(`no room was created: ${await host.page.locator('#link-note').innerText()}`);
  });
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

/** Sends a message on the viewer's own socket, the way the app would. */
const sendOnSocket = (v, t, d) =>
  v.page.evaluate(([type, data]) => window.__sockets.at(-1).send(JSON.stringify({ t: type, d: data })), [t, d]);

/** Does something that reaches the viewer as a room event, and returns as it lands. */
const roomEventFrom = async (v, action) => {
  const seen = await v.page.evaluate(() => window.__roomEvents);
  await action();
  await v.page.waitForFunction((count) => window.__roomEvents > count, seen, { timeout: 5000 });
};

const videoSources = (viewers) =>
  Promise.all(viewers.map((v) => v.page.evaluate(() => document.querySelector('video')?.currentSrc ?? '')));

const waitFor = async (check, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(100);
  }
  return false;
};

const allInState = async (viewers, state) =>
  (await sampleAll(viewers)).every((s) => s?.state === state);

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
  const offline = b.page.getByPlaceholder('Reconnecting…');
  await offline.waitFor({ state: 'visible', timeout: 2000 });
  await offline.waitFor({ state: 'hidden', timeout: 10000 });
  report.reconnectMs = Date.now() - cutAt;
  check('reconnects under 3s', report.reconnectMs < 3000, String(report.reconnectMs));
  await sleep(2000);
  const afterReconnect = pairwiseDrift(await sampleAll([a, b, c]));
  check('in sync after reconnect', afterReconnect < 0.15, `${Math.round(afterReconnect * 1000)}ms`);

  await a.page.screenshot({ path: `${OUT}/room-mp4.png` });
  report.mp4Errors = [...new Set([...a.errors, ...b.errors, ...c.errors])].slice(0, 5);
  await Promise.all([a, b, c].map((v) => v.context.close()));
}

// An event that leaves playback alone must not swallow a real pause. Each of these
// pauses the moment the event lands, inside what used to be an ignored window.
{
  const [host, guest] = await Promise.all(['host', 'guest'].map(viewer));
  const room = await createRoom(host, `${BASE}/sample.mp4`);
  await join(guest, room.url);
  check('pause after an event: both play', await waitPlaying([host, guest]), '');
  await sleep(3000);

  const pausesAndStays = async (label, pauser, event) => {
    await roomEventFrom(pauser, event);
    await pauser.page.evaluate(() => document.querySelector('video').pause());
    const landed = await waitFor(() => allInState([host, guest], 'paused'), 3000);
    await sleep(3000); // Long enough for a dropped pause to resume by itself.
    const states = (await sampleAll([host, guest])).map((s) => s?.state);
    check(`pause after ${label}: everyone stays paused`, landed && states.every((s) => s === 'paused'), states.join());
    await host.page.evaluate(() => document.querySelector('video').play());
    await waitFor(() => allInState([host, guest], 'playing'), 3000);
    await sleep(2000);
  };

  await host.page.getByRole('tab', { name: /People/ }).click();
  await pausesAndStays('a lock toggle', host, () => host.page.getByRole('switch').click());
  await pausesAndStays('an unlock', host, () => host.page.getByRole('switch').click());
  await pausesAndStays('a queue add', guest, () =>
    sendOnSocket(host, 'queue.add', { url: `${BASE}/sample.mp4?video=next`, mode: 'end' }));

  report.pauseAfterEventErrors = [...new Set([...host.errors, ...guest.errors])].slice(0, 5);
  await Promise.all([host, guest].map((v) => v.context.close()));
}

// Chrome's own controls pause on the way to something else. A double-click pauses
// and plays, and the timeline pauses, seeks and plays. None of that is a pause.
{
  const [host, guest] = await Promise.all(['host', 'guest'].map(viewer));
  const room = await createRoom(host, `${BASE}/sample.mp4`);
  await join(guest, room.url);
  check('native controls: both play', await waitPlaying([host, guest]), '');
  await sleep(3000);
  const box = await host.page.locator('video').boundingBox();
  const barY = box.y + box.height - 22;
  const barX = (share) => box.x + box.width * share;
  await host.page.mouse.move(barX(0.5), barY);
  await sleep(600);

  const sentFrom = (types) => host.page.evaluate((list) => {
    const seen = window.__sent.filter((type) => list.includes(type));
    window.__sent.length = 0;
    return seen;
  }, types);
  const roomMoved = async (share) => {
    const target = 300 * share;
    const landed = await waitFor(async () => {
      const samples = await sampleAll([host, guest]);
      return samples.every((s) => s.state === 'playing' && Math.abs(s.time - target) < 5) && pairwiseDrift(samples) < 0.3;
    }, 4000);
    return { landed, sent: await sentFrom(['play', 'pause', 'seek']) };
  };

  await sentFrom([]);
  await host.page.mouse.click(barX(0.55), barY);
  const click = await roomMoved(0.55);
  check('native controls: a timeline click is one seek', click.landed && click.sent.join() === 'seek', JSON.stringify(click));

  await sleep(2000);
  await host.page.mouse.move(barX(0.3), barY);
  await host.page.mouse.down();
  for (const share of [0.35, 0.4, 0.45, 0.5]) {
    await host.page.mouse.move(barX(share), barY);
    await sleep(300);
  }
  await host.page.mouse.up();
  const drag = await roomMoved(0.5);
  check('native controls: a timeline drag is one seek', drag.landed && drag.sent.join() === 'seek', JSON.stringify(drag));

  await sleep(2000);
  await host.page.mouse.dblclick(barX(0.5), box.y + box.height / 2);
  await sleep(1500);
  const states = (await sampleAll([host, guest])).map((s) => s?.state);
  const clicked = await sentFrom(['play', 'pause', 'seek']);
  check('native controls: a double-click leaves the room alone', states.every((s) => s === 'playing') && clicked.length === 0, `${states} ${clicked}`);

  report.nativeControlErrors = [...new Set([...host.errors, ...guest.errors])].slice(0, 5);
  await Promise.all([host, guest].map((v) => v.context.close()));
}

// Someone arriving after the queue moved on must get the room as it is now, not
// as it was. The queue change reaches viewers as one event; a late joiner only
// ever sees the snapshot in its welcome.
{
  const [a, b, late] = await Promise.all(['a', 'b', 'late'].map(viewer));
  const room = await createRoom(a, `${BASE}/sample.mp4`);
  await join(b, room.url);
  check('late join: first video plays', await waitPlaying([a, b]), '');

  const second = `${BASE}/sample.mp4?video=second`;
  await sendOnSocket(a, 'queue.add', { url: second, mode: 'now' });
  await sendOnSocket(b, 'queue.add', { url: `${BASE}/sample.mp4?video=third`, mode: 'end' });
  const switched = await waitFor(async () => (await videoSources([a, b])).every((src) => src === second), 8000);
  check('late join: queue change reaches everyone', switched, (await videoSources([a, b])).join());
  await waitPlaying([a, b]);
  await sleep(6000); // Far enough in that starting from zero would show.

  await join(late, room.url);
  check('late join: plays', await waitPlaying([a, b, late]), '');
  const [source] = await videoSources([late]);
  check('late join: gets the current video', source === second, source);
  await sleep(4000);
  report.lateJoinAfterQueue = await measure([a, b, late], 8);
  check('late join: in sync', report.lateJoinAfterQueue.p95 < 150, JSON.stringify(report.lateJoinAfterQueue));

  report.lateJoinErrors = [...new Set([...a.errors, ...b.errors, ...late.errors])].slice(0, 5);
  await Promise.all([a, b, late].map((v) => v.context.close()));
}

// A real network has latency. Everything above runs with none, which hides both
// clock error and any bug that needs a round trip with an odd length.
{
  const LATENCY_MS = 121;
  const a = await viewer('a');
  const far = await viewer('far', { latencyMs: LATENCY_MS });
  const room = await createRoom(a, `${BASE}/sample.mp4`);
  await join(far, room.url);
  check('latency: both start', await waitPlaying([a, far], 20000), '');

  // The numbers below mean nothing unless the delay is really there.
  // The app pings too, so only the pong that echoes this ping's t0 counts.
  const roundTrip = await far.page.evaluate(() => new Promise((resolve) => {
    const socket = window.__sockets.at(-1);
    const handler = socket.onmessage;
    const started = performance.now();
    const t0 = Date.now();
    socket.onmessage = (event) => {
      handler(event);
      const { t, d } = JSON.parse(event.data);
      if (t !== 'pong' || d.t0 !== t0) return;
      socket.onmessage = handler;
      resolve(performance.now() - started);
    };
    socket.send(JSON.stringify({ t: 'ping', d: { t0 } }));
  }));
  report.latencyRoundTripMs = Math.round(roundTrip);
  check('latency: round trip is really delayed', roundTrip >= LATENCY_MS * 2, `${Math.round(roundTrip)}ms`);
  await sleep(4000);

  report.latencySteady = await measure([a, far], 10);
  check('latency: steady drift under 150ms p95', report.latencySteady.p95 < 150, JSON.stringify(report.latencySteady));

  // Each one of these failed about half the time when ct arrived fractional.
  let landed = 0;
  for (let i = 0; i < 6; i += 1) {
    await far.page.evaluate(() => document.querySelector('video').pause());
    if (await waitFor(() => allInState([a, far], 'paused'), 3000)) landed += 1;
    await far.page.evaluate(() => document.querySelector('video').play());
    if (await waitFor(() => allInState([a, far], 'playing'), 3000)) landed += 1;
  }
  check('latency: every pause and play lands', landed === 12, `${landed} of 12`);

  // Straight after resuming, which is when a seek used to go unseen.
  const before = (await sampleAll([a]))[0].time;
  await far.page.evaluate((to) => { document.querySelector('video').currentTime = to; }, before + 30);
  const moved = await waitFor(async () => {
    const samples = await sampleAll([a, far]);
    return samples.every((s) => s.time > before + 25) && pairwiseDrift(samples) < 0.3;
  }, 6000);
  check('latency: seek from the far viewer moves the room', moved, '');

  await a.page.screenshot({ path: `${OUT}/room-latency.png` });
  report.latencyErrors = [...new Set([...a.errors, ...far.errors])].slice(0, 5);
  await Promise.all([a, far].map((v) => v.context.close()));
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
