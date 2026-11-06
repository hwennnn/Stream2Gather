// Puts a throttled real browser in a busy room and measures every interaction on
// the production build. `make perf` builds what it needs and runs it against a
// private server and a fake YouTube API, so it costs no quota. A run makes about
// 40 guests and the limit is 600 an hour, so clear limit:guest:* between long series.
//   PERF_BIN, PERF_WEB  a server binary and web build (with sample.mp4) to use instead
//   PERF_PORT           port for the private server (18086)
//   PERF_OUT            where to write the JSON results
//   PERF_NO_BUDGET=1    report only; don't fail on a budget
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { BASE, bot, build, fakeYouTube, feedback, feedbacks, here, PHONE, results, startServer, thumbnails, viewer, windowed, youtubeId } from './perf-lib.mjs';

const QUEUE_ROWS = 30;
const CHAT_LINES = 300;
const HOST_VIDEO = `${BASE}/sample.mp4`;

/** Anything over these fails the run. Set from the numbers in docs/rebuild/measurements.md. */
const budgets = JSON.parse(readFileSync(join(here, 'perf-budgets.json'), 'utf8'));

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

const paintsOf = (page) =>
  page.evaluate(() => {
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]));
    const resources = performance.getEntriesByType('resource');
    const scripts = resources.filter((entry) => /\.js$/.test(entry.name));
    return {
      fcp: Math.round(paint['first-contentful-paint'] ?? 0),
      jsKb: Math.round(scripts.reduce((sum, entry) => sum + entry.encodedBodySize, 0) / 1024),
      kb: Math.round(resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0) / 1024),
      requests: resources.length,
    };
  });

const firstFrame = () => {
  const element = document.querySelector('[data-player] video');
  return Boolean(element && element.currentTime > 0 && !element.paused);
};

const measureLoads = async (browser, thumbs, slug) => {
  const landing = [];
  const joins = [];
  for (let i = 0; i < 3; i += 1) {
    const { context, page } = await viewer(browser, thumbs);
    const started = Date.now();
    await page.goto(BASE, { waitUntil: 'commit' });
    await page.locator('#link').waitFor();
    const usable = Date.now() - started;
    await page.waitForLoadState('load');
    landing.push({ usable, ...(await paintsOf(page)) });
    await context.close();
  }
  for (let i = 0; i < 3; i += 1) {
    const { context, page } = await viewer(browser, thumbs);
    const started = Date.now();
    await page.goto(`${BASE}/r/${slug}`, { waitUntil: 'commit' });
    const button = page.getByRole('button', { name: 'Join' });
    await button.and(page.locator(':enabled')).waitFor();
    const gate = Date.now() - started;
    const paints = await paintsOf(page);
    await page.evaluate(() => window.__perf.begin());
    const [shell, frame] = await feedbacks(page, [() => document.querySelector('[role=tablist]') !== null, firstFrame], () => button.click());
    await page.evaluate(() => window.__perf.end());
    joins.push({ gate, shell, frame, ...paints });
    await context.close();
  }
  const middle = (rows, key) => median(rows.map((row) => row[key]));
  results.load_landing = { usable: middle(landing, 'usable'), fcp: middle(landing, 'fcp'), kb: middle(landing, 'kb'), jsKb: middle(landing, 'jsKb') };
  results.load_room = { gate: middle(joins, 'gate'), fcp: middle(joins, 'fcp'), shell: middle(joins, 'shell'), frame: middle(joins, 'frame'), kb: middle(joins, 'kb'), jsKb: middle(joins, 'jsKb'), requests: middle(joins, 'requests') };
};

const seedRoom = async (slug) => {
  const bots = await Promise.all(Array.from({ length: 4 }, (_, n) => bot(slug, `Viewer ${n + 1}`)));
  for (let n = 0; n < QUEUE_ROWS; n += 1) {
    bots[n % bots.length].send('queue.add', { url: `https://www.youtube.com/watch?v=${youtubeId(n)}`, mode: 'end' });
    await sleep(70);
  }
  bots[0].send('queue.add', { url: `${HOST_VIDEO}?second`, mode: 'next' });
  // Each socket has its own chat limit, so a crowd says what one viewer can't.
  const crowd = await Promise.all(Array.from({ length: 30 }, (_, n) => bot(slug, `Chatter ${n}`)));
  for (let line = 0; line < CHAT_LINES / crowd.length; line += 1) {
    crowd.forEach((one, n) => one.send('chat.send', { text: `Line ${line} from ${n}, with https://example.com/a-link and a few more words to wrap` }));
    await sleep(line < 4 ? 50 : 600);
  }
  crowd.forEach((one) => one.leave());
  await sleep(1500);
  return bots;
};

const measureRoom = async (host, peer, bots) => {
  const { page } = host;
  const tab = (name) => page.getByRole('tab', { name });

  await windowed(page, 'playing_idle', () => sleep(15000));

  await windowed(page, 'chat_arrival', async () => {
    for (let n = 0; n < 12; n += 1) {
      bots[n % bots.length].send('chat.send', { text: `Fresh line ${n}` });
      await sleep(500);
    }
  });

  await windowed(page, 'tabs', async () => {
    for (let n = 0; n < 4; n += 1) {
      for (const name of ['Queue', 'People', 'Chat']) {
        await tab(name).click();
        await sleep(350);
      }
    }
  });

  await windowed(page, 'chat_typing', async () => {
    await page.locator('#chat').click();
    await page.keyboard.type('the quick brown fox jumps over the lazy dog', { delay: 70 });
    await page.locator('#chat').fill('');
  });

  await windowed(page, 'chat_scroll', async () => {
    await page.mouse.move(1100, 300);
    for (let n = 0; n < 30; n += 1) {
      await page.mouse.wheel(0, n < 15 ? -240 : 240);
      await sleep(40);
    }
  });

  await windowed(page, 'send_chat', async () => ({
    feedbackMs: await feedback(page, () => document.querySelector('[data-delivery=sending]') !== null, async () => {
      await page.locator('#chat').fill('hello everyone');
      await page.keyboard.press('Enter');
    }),
  }));

  await tab('Queue').click();
  const box = page.locator('#omnibox');
  await windowed(page, 'search_typing', async () => {
    await box.click();
    await page.keyboard.type('lofi hip hop radio', { delay: 70 });
  });

  await windowed(page, 'search_open', async () => ({
    feedbackMs: await feedback(page, () => document.querySelector('[aria-label="Search results"]') !== null, () => page.keyboard.press('Enter')),
    resultsMs: await feedback(page, () => document.querySelectorAll('[aria-label="Search results"] li.row').length > 0, async () => {}, { now: true }),
  }));

  const rows = page.locator('[aria-label="Search results"] li.row');
  await windowed(page, 'search_scroll', async () => {
    await page.mouse.move(1100, 400);
    for (let n = 0; n < 30; n += 1) {
      await page.mouse.wheel(0, n < 15 ? 200 : -200);
      await sleep(40);
    }
  });

  await windowed(page, 'row_hover', async () => {
    for (let n = 0; n < 30; n += 1) {
      await page.mouse.move(1100, 180 + (n % 6) * 90, { steps: 4 });
      await sleep(30);
    }
  });

  await windowed(page, 'add_queue', async () => ({
    feedbackMs: await feedback(page, () => /Adding|Added|Already/.test(document.querySelector('[aria-label="Search results"]').textContent), () =>
      rows.nth(5).hover().then(() => rows.nth(5).getByRole('button', { name: /^Queue:/ }).click()),
    ),
  }));

  await page.keyboard.press('Escape');
  await sleep(500);

  await windowed(page, 'queue_drag', async () => {
    const grip = page.locator('[aria-label="Up next"] li.row').nth(1).locator('button[aria-hidden=true].cursor-grab');
    const where = await grip.boundingBox();
    const x = where.x + where.width / 2;
    const y = where.y + where.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(x, y + step * 7);
      await sleep(16);
    }
    await page.mouse.up();
  });

  await tab('Chat').click();
  await windowed(page, 'reaction', async () => {
    const times = [];
    for (let n = 0; n < 4; n += 1) {
      times.push(
        await feedback(page, () => document.querySelector('.reaction') !== null, () => page.getByRole('button', { name: 'React 🔥' }).click()),
      );
      await sleep(3300);
    }
    return { feedbackMs: median(times) };
  });

  // The native controls drive these, so the calls below are what a click does.
  await windowed(page, 'pause', async () => ({
    feedbackMs: await feedback(page, () => /Paused/.test(document.querySelector('[aria-label="Player controls"]').textContent), () => page.evaluate(() => document.querySelector('[data-player] video').pause()), { now: true }),
  }));
  await sleep(1000);
  await windowed(page, 'paused_idle', () => sleep(10000));
  await windowed(page, 'resume', async () => ({
    feedbackMs: await feedback(page, () => !/Paused/.test(document.querySelector('[aria-label="Player controls"]').textContent), () => page.evaluate(() => document.querySelector('[data-player] video').play()), { now: true }),
  }));
  await sleep(1500);
  await windowed(page, 'seek', async () => {
    const to = await page.evaluate(() => (document.querySelector('[data-player] video').currentTime + 60) % 240);
    const landed = peer.page.waitForFunction((target) => Math.abs(document.querySelector('[data-player] video').currentTime - target) < 5, to, { timeout: 15000, polling: 50 });
    const started = Date.now();
    await page.evaluate((target) => {
      document.querySelector('[data-player] video').currentTime = target;
    }, to);
    await landed;
    return { peerMs: Date.now() - started };
  });
  await sleep(1500);

  await tab('Queue').click();
  await windowed(page, 'play_now', async () => {
    const row = page.locator('[aria-label="Up next"] li.row').first();
    await row.hover();
    await page.evaluate(() => {
      window.__oldVideo = document.querySelector('[data-player] video');
    });
    const newFrame = () => {
      const element = document.querySelector('[data-player] video');
      return Boolean(element && element !== window.__oldVideo && element.currentTime > 0 && !element.paused);
    };
    const [feedbackMs, frameMs] = await feedbacks(
      page,
      [() => document.querySelector('[data-starting], .stage [role=status]') !== null, newFrame],
      () => row.getByRole('button', { name: /^Play now/ }).click(),
    );
    return { feedbackMs, frameMs };
  });
};

/** The tray only exists on touch, where rows have no hover. */
const measureTray = async (browser, thumbs, slug) => {
  const { context, page } = await viewer(browser, thumbs, { device: PHONE });
  await page.goto(`${BASE}/r/${slug}`);
  await page.getByRole('button', { name: 'Join' }).tap();
  await page.getByRole('tab', { name: 'Queue' }).tap();
  await sleep(1000);
  await windowed(page, 'row_expand', async () => {
    const times = [];
    for (let n = 0; n < 4; n += 1) {
      const more = page.locator('[aria-label="Up next"] li.row').nth(n).getByRole('button', { name: /^More for/ });
      times.push(await feedback(page, () => document.querySelector('[aria-label="Up next"] [aria-expanded=true]') !== null, () => more.tap()));
      await more.tap();
      await sleep(300);
    }
    return { feedbackMs: median(times) };
  });
  await context.close();
};

const checkBudgets = () => {
  const failures = [];
  for (const [path, limit] of Object.entries(budgets)) {
    const [scenario, key] = path.split('.');
    const value = results[scenario]?.[key];
    const perSecond = key.endsWith('PerSecond');
    const measured = perSecond ? results[scenario][key.replace('PerSecond', '')] / results[scenario].seconds : value;
    if (measured === undefined || measured > limit) failures.push(`${path}: ${measured} is over ${limit}`);
  }
  return failures;
};

const main = async () => {
  const work = mkdtempSync(join(tmpdir(), 's2g-perf-'));
  const youtube = await fakeYouTube();
  const server = await startServer(build(work), work, youtube.url);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const thumbs = await thumbnails();
    const host = await viewer(browser, thumbs);
    await host.page.goto(BASE);
    const slug = await host.page.evaluate(async (url) => {
      const answer = await fetch('/v1/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      return (await answer.json()).slug;
    }, HOST_VIDEO);
    await host.page.goto(`${BASE}/r/${slug}`);
    // The host of a new room walks straight in; anyone else stops at the gate.
    const tabs = host.page.locator('[role=tablist]');
    const join = host.page.getByRole('button', { name: 'Join' });
    await tabs.or(join).first().waitFor();
    if (await join.isVisible()) await join.click();
    await tabs.waitFor();

    const peer = await viewer(browser, thumbs, { slow: false });
    await peer.page.goto(`${BASE}/r/${slug}`);
    await peer.page.getByRole('button', { name: 'Join' }).and(peer.page.locator(':enabled')).click();
    await peer.page.locator('[role=tablist]').waitFor();

    const bots = await seedRoom(slug);
    await measureLoads(browser, thumbs, slug);
    await measureRoom(host, peer, bots);
    await measureTray(browser, thumbs, slug);
    bots.forEach((one) => one.leave());
  } finally {
    await browser.close();
    server.kill();
    youtube.server.close();
  }

  const failures = process.env.PERF_NO_BUDGET ? [] : checkBudgets();
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
  console.table(Object.fromEntries(Object.entries(results).map(([name, row]) => {
    const { names, wsTypes, ...numbers } = row;
    return [name, Object.fromEntries(Object.entries(numbers).map(([key, value]) => [key, Math.round(value)]))];
  })));
  failures.forEach((failure) => console.log(`OVER BUDGET  ${failure}`));
  process.exit(failures.length ? 1 : 0);
};

await main();
