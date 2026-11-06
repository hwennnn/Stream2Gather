// Proves nothing is ever drawn over the player, as YouTube's terms require.
// Drives the real web client against a scripted room, at every layout, through
// the states most likely to break the rule: reactions, toasts, menus, search,
// theatre, fullscreen, going offline, all with voice open.
// Run: BASE=http://127.0.0.1:18080 node web/scripts/player-overlap.mjs
// Needs e2e/node_modules, and sample.mp4 in the web build.
import { chromium } from '../../e2e/node_modules/playwright-core/index.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:18080';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SLUG = 'overlap-check';

const PHONE = {
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const LAYOUTS = [
  ['1440x900', { viewport: { width: 1440, height: 900 } }],
  ['1920x1080', { viewport: { width: 1920, height: 1080 } }],
  ['1024x768', { viewport: { width: 1024, height: 768 } }],
  ['820x1180', { viewport: { width: 820, height: 1180 }, hasTouch: true }],
  ['390x844', { ...PHONE, viewport: { width: 390, height: 844 } }],
  ['844x390', { ...PHONE, viewport: { width: 844, height: 390 } }],
];

const video = (id, title) => ({
  id: `item-${id}`,
  source: 'youtube',
  sourceId: id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title,
  author: 'Blender',
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  durationMs: 634_000,
  isLive: false,
  addedBy: 'g_host',
  addedByName: 'Maya',
});

const file = () => ({
  ...video('file', 'A file'),
  source: 'direct',
  sourceId: 'file',
  url: `${BASE}/sample.mp4`,
  thumbnailUrl: '',
});

const people = [
  { userId: 'g_host', name: 'Maya', role: 'host' },
  { userId: 'g_self', name: 'Ada', role: 'member' },
  { userId: 'g_other', name: 'Sam', role: 'member' },
];

const messages = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  userId: 'g_host',
  author: 'Maya',
  body: `message ${index}`,
  createdAt: new Date(Date.now() - (20 - index) * 60_000).toISOString(),
}));

const mockRoom = async (page, current) => {
  const queue = [current, video('T4Eh0M-Sh_g', 'Next'), video('Pu0pH5BuCPM', 'After that')];
  const preview = { slug: SLUG, name: 'Room', nowPlaying: current, members: people, playback: { status: 'playing', pos: 3 }, maxMembers: 50 };
  await page.route(`**/v1/rooms/${SLUG}/ticket`, (route) => route.fulfill({ json: { ticket: 't' } }));
  await page.route(`**/v1/rooms/${SLUG}/messages`, (route) => route.fulfill({ json: { items: [...messages].reverse() } }));
  await page.route(`**/v1/rooms/${SLUG}`, (route) => route.fulfill({ json: preview }));
  await page.route('**/v1/media/search*', (route) => route.fulfill({ json: { items: [video('dQw4w9WgXcQ', 'A result')] } }));
  await page.route('**/v1/telemetry', (route) => route.fulfill({ status: 204, body: '' }));
  // A token that never comes keeps the voice panel open without a voice server.
  await page.route(`**/v1/rooms/${SLUG}/voice-token`, () => {});
  await page.route('**/v1/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), voice: true } });
  });

  const room = { socket: null, send: (t, d) => room.socket?.send(JSON.stringify({ t, d })) };
  await page.routeWebSocket(/\/v1\/ws/, (socket) => {
    room.socket = socket;
    const playback = { item: current.id, status: 'playing', pos: 3, at: Date.now(), rate: 1 };
    const state = { version: 5, playback, queue, settings: { controlMode: 'everyone', queueMode: 'everyone' } };
    socket.send(JSON.stringify({ t: 'welcome', d: { self: people[1], room: { name: 'Room' }, state, members: people } }));
    socket.onMessage((raw) => {
      const message = JSON.parse(raw);
      if (message.t === 'ping') socket.send(JSON.stringify({ t: 'pong', d: { t0: message.d?.t0, ts: Date.now(), version: 5 } }));
      else if (message.id) socket.send(JSON.stringify({ t: 'ack', d: { id: message.id } }));
    });
  });
  return room;
};

/**
 * Runs in the page. Records every element that shows inside the player's
 * rectangle, on every frame, until stopped. Clipped overflow doesn't count,
 * because it can't be seen; anything that is hit-testable or painted does.
 */
const installWatcher = () => {
  const found = new Map();
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  };
  const clipped = (element) => {
    const area = box(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = box(parent);
      area.left = Math.max(area.left, clip.left);
      area.top = Math.max(area.top, clip.top);
      area.right = Math.min(area.right, clip.right);
      area.bottom = Math.min(area.bottom, clip.bottom);
    }
    return area;
  };
  const name = (element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} "${(element.textContent ?? '').slice(0, 30)}"`;
  const check = () => {
    const mount = document.querySelector('[data-player]');
    const surface = mount?.querySelector('iframe, video');
    if (!surface) return;
    const player = box(surface);
    for (const element of document.body.querySelectorAll('*')) {
      if (surface === element || surface.contains(element) || element.contains(surface)) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < 0.02) continue;
      const area = clipped(element);
      const width = Math.min(area.right, player.right) - Math.max(area.left, player.left);
      const height = Math.min(area.bottom, player.bottom) - Math.max(area.top, player.top);
      if (width > 0.5 && height > 0.5) found.set(name(element), `${Math.round(width)}x${Math.round(height)}`);
    }
    const columns = 16;
    const rows = 9;
    for (let x = 0; x < columns; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const left = player.left + ((x + 0.5) / columns) * (player.right - player.left);
        const top = player.top + ((y + 0.5) / rows) * (player.bottom - player.top);
        const hit = document.elementFromPoint(left, top);
        if (hit && hit !== surface && !surface.contains(hit)) found.set(`hit: ${name(hit)}`, `${Math.round(left)},${Math.round(top)}`);
      }
    }
  };
  let running = true;
  const frame = () => {
    if (!running) return;
    check();
    requestAnimationFrame(frame);
  };
  window.__overlap = {
    start: () => {
      found.clear();
      running = true;
      frame();
    },
    stop: () => {
      running = false;
      return [...found];
    },
  };
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const failures = [];
let checks = 0;

const during = async (page, label, work) => {
  await page.evaluate(() => window.__overlap.start());
  await work();
  await sleep(200);
  const hits = await page.evaluate(() => window.__overlap.stop());
  checks += 1;
  console.log(`${hits.length === 0 ? 'pass' : 'FAIL'}  ${label}`);
  for (const [what, where] of hits.slice(0, 6)) failures.push(`${label}: ${what} (${where})`);
};

const noticeBurst = (room) => {
  room.send('notice', { text: 'Skipped “A video”. Its owner only allows it on YouTube.', url: 'https://www.youtube.com/watch?v=x' });
  room.send('error', { message: 'Slow down a little.' });
  room.send('error', { message: 'Slow down a little.' });
};

const reactionBurst = async (room) => {
  for (let index = 0; index < 8; index += 1) {
    room.send('react', { emoji: '🔥', name: 'Maya' });
    await sleep(100);
  }
  await sleep(2700);
};

for (const [layout, options] of LAYOUTS) {
  for (const [kind, current] of [['file', file()], ['youtube', video('aqz-KE-bpKQ', 'Big Buck Bunny')]]) {
    const label = `${layout} ${kind}`;
    const context = await browser.newContext(options);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
    const page = await context.newPage();
    await page.addInitScript(installWatcher);
    const room = await mockRoom(page, current);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const tab = (name) => press(page.getByRole('tab', { name: new RegExp(`^${name}`) }));

    await page.goto(`${BASE}/r/${SLUG}`);
    await page.getByRole('button', { name: 'Join' }).click();
    await page.waitForSelector('[data-player] iframe, [data-player] video', { timeout: 20_000 });
    // The poster stands in until the player has a picture, so nothing can be judged before it goes.
    await page.waitForFunction(() => !document.querySelector('.stage > [aria-hidden="true"]'), null, { timeout: 25_000 });

    const controls = await page.evaluate(() => {
      const surface = document.querySelector('[data-player] iframe, [data-player] video');
      return surface.tagName === 'VIDEO' ? surface.controls : !/[?&]controls=0/.test(surface.src);
    });
    checks += 1;
    if (!controls) failures.push(`${label}: native controls are off`);

    // A check that can't fail proves nothing, so first make it fail on purpose.
    await page.evaluate(() => {
      window.__overlap.start();
      const player = document.querySelector('[data-player]').getBoundingClientRect();
      const canary = document.createElement('div');
      canary.style.cssText = `position:fixed;left:${player.left + 10}px;top:${player.top + 10}px;width:40px;height:40px;pointer-events:none;z-index:9`;
      canary.id = 'canary';
      document.body.append(canary);
    });
    await sleep(150);
    const caught = await page.evaluate(() => {
      document.getElementById('canary').remove();
      return window.__overlap.stop().length > 0;
    });
    checks += 1;
    if (!caught) failures.push(`${label}: the watcher missed a planted overlay`);

    await during(page, `${label} playing`, () => sleep(400));
    // Everything after this runs with voice open.
    await during(page, `${label} voice`, async () => {
      await press(page.getByRole('button', { name: 'Join voice' }));
      await page.getByRole('group', { name: 'Voice' }).waitFor();
      await sleep(300);
    });
    await during(page, `${label} reactions`, () => reactionBurst(room));
    await during(page, `${label} toasts`, async () => {
      noticeBurst(room);
      await sleep(500);
    });
    await during(page, `${label} invite`, async () => {
      if (!options.hasTouch) await press(page.getByRole('button', { name: 'Invite' }));
      await sleep(400);
    });
    await during(page, `${label} queue and search`, async () => {
      await tab('Queue');
      await page.fill('#omnibox', 'a search');
      await page.press('#omnibox', 'Enter');
      await sleep(400);
      await page.keyboard.press('Escape');
      await sleep(200);
    });
    await during(page, `${label} people`, async () => {
      await tab('People');
      await sleep(200);
    });
    if (layout === '390x844' || layout === '844x390') {
      await during(page, `${label} reaction picker`, async () => {
        await tab('Chat');
        await press(page.getByRole('button', { name: 'Send a reaction' }));
        await sleep(300);
        await page.keyboard.press('Escape');
      });
    }
    if (options.viewport.width >= 1024) {
      await during(page, `${label} theatre`, async () => {
        await page.keyboard.press('t');
        await sleep(300);
        noticeBurst(room);
        await sleep(500);
        await page.keyboard.press('t');
      });
      await during(page, `${label} fullscreen`, async () => {
        await page.keyboard.press('f');
        await sleep(600);
        noticeBurst(room);
        await sleep(400);
        await page.keyboard.press('f');
        await sleep(300);
      });
    }
    await during(page, `${label} offline`, async () => {
      await page.route(`**/v1/rooms/${SLUG}/ticket`, (route) => route.abort());
      await room.socket.close();
      await sleep(1800);
    });
    await context.close();
  }
}

await browser.close();
console.log(`\n${checks} checks, ${failures.length} problems`);
for (const failure of failures) console.log(`  ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
