// What e2e/perf.mjs is built from: a private server, a fake YouTube API, viewers
// with no browser, and throttled real ones. See perf.mjs for how to run it.
import { execFileSync, spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
export const port = Number(process.env.PERF_PORT ?? 18086);
export const BASE = `http://localhost:${port}`;
const CPU_SLOWDOWN = 4;
const SOCKET_DELAY_MS = 40; // Each way, so about what a nearby server costs.
const NETWORK = { offline: false, latency: 2 * SOCKET_DELAY_MS, downloadThroughput: 2.5e6, uploadThroughput: 1e6 };
const SEARCH_DELAY_MS = 250;
// Limits live in the shared Redis, where everything on this machine counts as one address,
// so a run brings its own. A busy night used up the rooms limit and every run failed at the start.
const ADDRESS = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const FROM_HERE = { 'x-forwarded-for': ADDRESS };

export const youtubeId = (n) => `perfvideo${String(n).padStart(2, '0')}`;
const video = (id) => {
  const size = (name) => ({ url: `https://i.ytimg.com/vi/${id}/${name}.jpg` });
  return {
    id,
    snippet: {
      title: `A fairly long video title that needs two lines in the rail, number ${id}`,
      channelTitle: 'Perf channel',
      liveBroadcastContent: 'none',
      thumbnails: { default: size('default'), medium: size('mqdefault'), high: size('hqdefault'), standard: size('sddefault'), maxres: size('maxresdefault') },
    },
    contentDetails: { duration: 'PT4M13S' },
    status: { embeddable: true, privacyStatus: 'public' },
  };
};

export const fakeYouTube = () =>
  new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url, 'http://fake');
      let items;
      if (url.pathname === '/search') {
        await sleep(SEARCH_DELAY_MS);
        items = Array.from({ length: 25 }, (_, n) => ({ id: { videoId: youtubeId(n + 50) } }));
      } else if (url.searchParams.get('chart')) {
        items = Array.from({ length: 50 }, (_, n) => video(youtubeId(n)));
      } else {
        items = url.searchParams.get('id').split(',').map(video);
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ items }));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });

export const build = (work) => {
  const web = process.env.PERF_WEB ?? join(work, 'web');
  const bin = process.env.PERF_BIN ?? join(work, 's2g');
  if (!process.env.PERF_WEB) execFileSync('npx', ['vite', 'build', '--outDir', web, '--emptyOutDir'], { cwd: join(root, 'web'), stdio: 'ignore' });
  if (!process.env.PERF_BIN) execFileSync('go', ['build', '-o', bin, './cmd/s2g'], { cwd: join(root, 'server'), stdio: 'inherit' });
  const sample = join(root, '.data/sample.mp4');
  if (!process.env.PERF_WEB) {
    if (!existsSync(sample)) execFileSync('make', ['-C', root, 'sample'], { stdio: 'inherit' });
    copyFileSync(sample, join(web, 'sample.mp4'));
  }
  return { web, bin };
};

export const startServer = async ({ web, bin }, work, youtube) => {
  // A server left by a killed run would answer readyz and measure the wrong build.
  if (await fetch(`${BASE}/readyz`).then(() => true, () => false)) throw new Error(`port ${port} is already serving`);
  // It runs away from server/ so that a real YOUTUBE_API_KEY in .env.local can't apply.
  const server = spawn(bin, ['serve'], {
    cwd: work,
    stdio: 'ignore',
    env: { ...process.env, HTTP_ADDR: `127.0.0.1:${port}`, PUBLIC_ORIGIN: BASE, ALLOW_DIRECT_MEDIA: 'true', TRUSTED_PROXY: 'true', WEB_DIR: web, YOUTUBE_API_KEY: 'fake', YOUTUBE_BASE_URL: youtube },
  });
  for (let i = 0; i < 100; i += 1) {
    if (await fetch(`${BASE}/readyz`).then((r) => r.ok, () => false)) return server;
    await sleep(100);
  }
  throw new Error('the server did not start');
};

/** A viewer with no browser: a socket and a name, enough to be someone in the room. */
export const bot = async (slug, name) => {
  const session = await fetch(`${BASE}/v1/me`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...FROM_HERE }, body: JSON.stringify({ name }) });
  if (!session.ok) throw new Error(`no guest session (${session.status})`);
  const cookie = session.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const answer = await fetch(`${BASE}/v1/rooms/${slug}/ticket`, { method: 'POST', headers: { cookie, ...FROM_HERE } });
  const { ticket } = await answer.json();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?ticket=${ticket}`);
  await new Promise((resolve, reject) => {
    socket.onmessage = resolve;
    socket.onerror = reject;
  });
  const beat = setInterval(() => socket.send('{"t":"ping"}'), 3000);
  let next = 1;
  return {
    send: (t, d) => socket.send(JSON.stringify({ t, id: `b${next++}`, d })),
    leave: () => {
      clearInterval(beat);
      socket.close();
    },
  };
};

export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

export const viewer = async (browser, thumbs, { slow = true, device = { viewport: { width: 1280, height: 800 } } } = {}) => {
  const context = await browser.newContext({ ...device, extraHTTPHeaders: FROM_HERE });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  // Thumbnails come from memory at their real sizes, so no run waits on the network.
  await context.route('https://i.ytimg.com/**', (route) => {
    const body = thumbs[/\/(\w+)\.jpg/.exec(route.request().url())?.[1]] ?? thumbs.maxresdefault;
    return route.fulfill({ body, contentType: 'image/jpeg', headers: { 'cache-control': 'max-age=3600', 'access-control-allow-origin': '*' } });
  });
  await context.addInitScript(`window.__perfSocketDelay = ${SOCKET_DELAY_MS}`);
  await context.addInitScript({ path: join(here, 'perf-probe.js') });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (slow) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  return { context, page, cdp };
};

export const thumbnails = async () => {
  const names = ['mqdefault', 'hqdefault', 'sddefault', 'maxresdefault'];
  const bodies = await Promise.all(
    names.map((name) => fetch(`https://i.ytimg.com/vi/aqz-KE-bpKQ/${name}.jpg`).then((r) => r.arrayBuffer()).then(Buffer.from, () => Buffer.alloc(0))),
  );
  return Object.fromEntries(names.map((name, index) => [name, bodies[index]]));
};

export const results = {};
export const windowed = async (page, name, run) => {
  await page.evaluate(() => window.__perf.begin());
  const extra = (await run()) ?? {};
  results[name] = { ...(await page.evaluate(() => window.__perf.end())), ...extra };
};

/** Milliseconds from the input in act to the first frame where each check holds. */
export const feedbacks = async (page, checks, act, { now = false, timeout = 30000 } = {}) => {
  await page.evaluate(([sources, immediately]) => {
    window.__perf.arm(sources.map((source) => (0, eval)(`(${source})`)), immediately); // eslint-disable-line no-eval
  }, [checks.map(String), now]);
  await act();
  await page.waitForFunction(() => window.__perf.elapsed() !== null, null, { timeout, polling: 50 });
  return (await page.evaluate(() => window.__perf.elapsed())).map(Math.round);
};

export const feedback = async (page, check, act, options) => (await feedbacks(page, [check], act, options))[0];

