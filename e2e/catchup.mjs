// Hana watches and reacts. Mika wasn't there, and catches up later on her own: the
// reactions must come back at the positions they were made, with no socket open.
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { mintAccount } from './mint-account/mint.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:18082';
const OUT = process.argv[2] ?? '.';
const FIRE_BUDGET_MS = 500;
const REACTIONS = 4;
const REACT_GAP_MS = 1200;
const SWEEP_TRIES = 20;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}  ${detail}`);
};
const visible = (locator, timeout = 5000) => locator.waitFor({ timeout }).then(() => true, () => false);

const person = async (name, viewport = { width: 1280, height: 800 }) => {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const { cookie } = await mintAccount(name);
  await context.addCookies([{ name: 's2g_session', value: cookie, url: BASE }]);
  const page = await context.newPage();
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    window.__sockets = 0;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        window.__sockets += 1;
      }
    };
  });
  return { context, page };
};
const button = ({ page }, name) => page.getByRole('button', { name });

const hana = await person('Hana');
await hana.page.goto(BASE);
await button(hana, 'Start a crew').click();
await hana.page.fill('#crew-name', 'Long distance');
await hana.page.keyboard.press('Enter');
await hana.page.waitForURL(/\/r\//);
const home = hana.page.url();
const slug = new URL(home).pathname.split('/')[2];
await button(hana, 'Copy').click();
const invite = await hana.page.evaluate(() => navigator.clipboard.readText());

const mika = await person('Mika');
await mika.page.goto(invite);
await button(mika, 'Join the crew').click();
await button(mika, /Join the room/).waitFor();

await hana.page.fill('#crew-watchlist', `${BASE}/sample.mp4`);
await hana.page.keyboard.press('Enter');
await hana.page.getByRole('button', { name: 'Remove sample' }).waitFor();
await button(hana, /Join the room/).click();
await hana.page.getByRole('tab', { name: 'People' }).waitFor();
await hana.page.getByRole('region', { name: 'Your watchlist' }).getByRole('button', { name: /Queue sample|Play now: sample/ }).first().click();
await hana.page.locator('video').waitFor();
await sleep(1500);
for (let i = 0; i < REACTIONS; i += 1) {
  await button(hana, 'React 🔥').first().click();
  await sleep(REACT_GAP_MS);
}
await hana.page.getByPlaceholder('Message').fill('the ending though');
await hana.page.keyboard.press('Enter');
await sleep(2500);
await hana.page.goto('about:blank');

const { rows } = await db.query(
  `SELECT s.id FROM crew_sessions s JOIN crews c ON c.id = s.crew_id JOIN rooms r ON r.id = c.room_id WHERE r.slug = $1`,
  [slug],
);
const sessionId = rows[0]?.id;
let ended = false;
for (let i = 0; i < SWEEP_TRIES && !ended; i += 1) {
  await db.query(`UPDATE session_people SET left_at = now() - interval '6 minutes' WHERE session_id = $1`, [sessionId]);
  await db.query(`UPDATE crew_sessions SET last_activity_at = now() - interval '6 minutes' WHERE id = $1`, [sessionId]);
  await promisify(execFile)(process.env.S2G, ['sweep']);
  const open = await db.query(`SELECT 1 FROM crew_sessions WHERE id = $1 AND ended_at IS NOT NULL`, [sessionId]);
  ended = open.rows.length === 1;
  if (!ended) await sleep(1000);
}
check('the session ended', ended);

// From the home: one click to the page, one on Play.
await mika.page.reload();
const offer = mika.page.getByRole('link', { name: 'You missed this. Catch up.' });
check('the home offers what was missed', await visible(offer));
check('the home keeps chat to itself', !(await mika.page.locator('body').innerText()).includes('the ending though'));
await mika.page.goto(home); // A fresh load, so the socket count below starts at this page's own.
await offer.click();
await mika.page.waitForURL(/\/catchup\//);
const video = mika.page.locator('video');
await video.waitFor();
await sleep(500);
check('nothing plays until asked', await video.evaluate((element) => element.paused));
await mika.page.screenshot({ path: `${OUT}/catchup-before.png` });

await video.evaluate((element) => element.play());
const fired = mika.page.locator('[data-fired]');
await fired.first().waitFor({ timeout: 15_000 });
await sleep(1500 + (REACTIONS + 2) * REACT_GAP_MS);
const seen = await mika.page.locator('[data-fired]').evaluateAll((lines) =>
  lines.map((line) => ({ pos: Number(line.dataset.pos), fired: Number(line.dataset.fired), text: line.textContent })),
);
check('every moment fired', seen.length === REACTIONS + 1, `${seen.length} of ${REACTIONS + 1}`);
const worst = Math.max(...seen.map((moment) => Math.abs(moment.fired - moment.pos)));
check('each fired on time', worst <= FIRE_BUDGET_MS, `worst ${worst} ms, budget ${FIRE_BUDGET_MS}`);
check('it says who', seen[0]?.text.startsWith('Hana,'), seen[0]?.text);
check('chat comes back too', seen.some((moment) => moment.text.includes('the ending though')));
check('no socket opened', (await mika.page.evaluate(() => window.__sockets)) === 0);
await mika.page.screenshot({ path: `${OUT}/catchup-rail.png` });

// A long way forward: everything passed shows at once, and none of it fires.
await video.evaluate((element) => {
  element.pause();
  element.currentTime = 0;
});
await sleep(600);
await video.evaluate((element) => {
  element.currentTime = 120;
  return element.play();
});
await sleep(1500);
const lines = await mika.page.getByRole('list', { name: 'Reactions' }).getByRole('listitem').count();
const burst = await mika.page.locator('[data-fired]').count();
check('seeking fires nothing', lines === REACTIONS + 1 && burst === 0, `${lines} lines, ${burst} fired`);

// What she adds is there for the next person, and stays out of the room.
await video.evaluate((element) => element.pause());
await button(mika, 'React 😂').click();
await mika.page.fill('#catchup-chat', 'caught up');
await mika.page.keyboard.press('Enter');
check('her reaction joins the rail', await visible(mika.page.getByRole('list', { name: 'Reactions' }).getByText('😂')));
await sleep(300);

const AT_MS = 2000;
await hana.page.goto(`${mika.page.url().split('?')[0]}?at=${AT_MS}`);
await hana.page.locator('video').waitFor();
await sleep(500);
const start = await hana.page.locator('video').evaluate((element) => element.currentTime);
check('a link can start at a moment', Math.abs(start * 1000 - AT_MS) < 200, `${start}s`);
await hana.page.locator('video').evaluate((element) => {
  element.currentTime = 130;
});
await sleep(800);
const rail = await hana.page.getByRole('list', { name: 'Reactions' }).innerText();
check('the next person sees it', rail.includes('😂') && rail.includes('caught up'), rail.split('\n').at(-1));

await hana.page.goto(home);
await button(hana, /Join the room/).click();
await hana.page.getByRole('tab', { name: 'People' }).waitFor();
await sleep(500);
check('what she said stays out of the room', !(await hana.page.locator('body').innerText()).includes('caught up'));

// A phone puts the rail under the player.
const phone = await person('Ren', { width: 390, height: 844 });
await phone.page.goto(invite);
await button(phone, 'Join the crew').click();
await button(phone, /Join the room/).waitFor();
await phone.page.getByRole('link', { name: 'You missed this. Catch up.' }).click();
const small = phone.page.locator('video');
await small.waitFor();
await small.evaluate((element) => element.play());
await phone.page.locator('[data-fired]').nth(2).waitFor({ timeout: 15_000 });
await phone.page.screenshot({ path: `${OUT}/catchup-phone.png`, fullPage: true });

await browser.close();
await db.end();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
