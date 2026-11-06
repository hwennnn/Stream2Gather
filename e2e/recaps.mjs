// Two people watch, react and go home; a sweep ends the session; the recap renders
// on the crew's home and, once shared, for someone signed out.
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { mintAccount } from './mint-account/mint.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:18082';
const OUT = process.argv[2] ?? '.';
const CHAT = 'only the crew reads this';
const REACT_GAP_MS = 600;
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

const person = async (name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  if (name) {
    const { cookie } = await mintAccount(name);
    await context.addCookies([{ name: 's2g_session', value: cookie, url: BASE }]);
  }
  return { context, page: await context.newPage() };
};

const button = ({ page }, name) => page.getByRole('button', { name });
const enter = async (who) => {
  await button(who, /Join the room/).click();
  await who.page.getByRole('tab', { name: 'People' }).waitFor();
};
const react = async (who, emoji, times) => {
  for (let i = 0; i < times; i += 1) {
    await button(who, `React ${emoji}`).first().click();
    await sleep(REACT_GAP_MS);
  }
};

const hana = await person('Hana');
await hana.page.goto(BASE);
await button(hana, 'Start a crew').click();
await hana.page.fill('#crew-name', 'Sundays');
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
await enter(hana);
await hana.page.getByRole('region', { name: 'Your watchlist' }).getByRole('listitem').first().hover();
await hana.page.getByRole('region', { name: 'Your watchlist' }).getByRole('button', { name: 'Add: sample' }).click();
await hana.page.locator('video').waitFor();
await enter(mika);
await mika.page.locator('video').waitFor();

await Promise.all([react(hana, '🔥', 3), react(mika, '🔥', 2)]);
await react(mika, '😂', 1);
await hana.page.getByRole('tab', { name: 'Chat' }).click().catch(() => {});
await hana.page.getByPlaceholder(/message/i).fill(CHAT);
await hana.page.keyboard.press('Enter');
await sleep(2500); // The recorder flushes every second.

await hana.page.goto('about:blank');
await mika.page.goto('about:blank');

// The sweep waits five minutes after the last person leaves, so that's moved back.
const session = await db.query(
  `SELECT s.id FROM crew_sessions s JOIN crews c ON c.id = s.crew_id JOIN rooms r ON r.id = c.room_id WHERE r.slug = $1`,
  [slug],
);
const sessionId = session.rows[0]?.id;
check('playing opened a session', Boolean(sessionId));
let ended = false;
for (let i = 0; i < SWEEP_TRIES && !ended; i += 1) {
  await db.query(`UPDATE session_people SET left_at = now() - interval '6 minutes' WHERE session_id = $1`, [sessionId]);
  await db.query(`UPDATE crew_sessions SET last_activity_at = now() - interval '6 minutes' WHERE id = $1`, [sessionId]);
  await promisify(execFile)(process.env.S2G, ['sweep']);
  const { rows } = await db.query(`SELECT 1 FROM session_recaps WHERE session_id = $1`, [sessionId]);
  ended = rows.length === 1;
  if (!ended) await sleep(1000);
}
check('the sweep ended the session and built its recap', ended);

await hana.page.goto(home);
const card = hana.page.getByRole('region', { name: 'Recap' });
check('the recap is at the top of the home', await visible(card));
const text = await card.innerText();
check('it says who came', text.includes('Hana') && text.includes('Mika'), text.split('\n')[0]);
check('it counts the reactions', text.includes('6 reactions'), text);
check('it names the video', text.includes('sample'));
check('it finds the biggest moment', text.includes('Biggest moment'));
check('it can be relived', (await card.getByRole('link', { name: 'Relive it' }).getAttribute('href'))?.includes('/catchup/'));
check('the page says where the numbers come from', await visible(hana.page.getByText('come from Stream2Gather, not YouTube')));
await hana.page.screenshot({ path: `${OUT}/recap-home.png`, fullPage: true });
await hana.page.setViewportSize({ width: 390, height: 844 });
await hana.page.screenshot({ path: `${OUT}/recap-home-phone.png` });
await hana.page.setViewportSize({ width: 1280, height: 800 });

await button(hana, 'Share this recap').click();
const link = hana.page.getByLabel('Recap link');
await link.waitFor();
const shared = await link.inputValue();
check('sharing makes a link', shared.includes('/s/'), shared.replace(/\/s\/.*/, '/s/…'));

const stranger = await person(null);
const opened = await stranger.page.goto(shared);
check('a stranger can read it', await visible(stranger.page.getByRole('heading', { name: 'Sundays' })));
check('crawlers are told to stay out', opened.headers()['x-robots-tag'] === 'noindex');
check('it has a way in', await visible(stranger.page.getByRole('link', { name: 'Start your own room' })));
const page = await stranger.page.locator('body').innerText();
check('it shows no chat', !page.includes(CHAT));
const token = shared.split('/s/')[1];
const json = await fetch(`${BASE}/v1/recaps/${token}`).then((reply) => reply.text());
check('neither does its data', !json.includes(CHAT) && json.includes('Sundays'));
check('it embeds nothing', (await stranger.page.locator('iframe, video').count()) === 0);
await stranger.page.screenshot({ path: `${OUT}/recap-shared.png`, fullPage: true });
await stranger.page.setViewportSize({ width: 390, height: 844 });
await stranger.page.screenshot({ path: `${OUT}/recap-shared-phone.png` });

await button(hana, 'Stop sharing').click();
await button(hana, 'Share this recap').waitFor();
const after = await fetch(`${BASE}/v1/recaps/${token}`);
check('revoking stops it on the next request', after.status === 404, `${after.status}`);
await stranger.page.reload();
check('and the page says so', await visible(stranger.page.getByRole('heading', { name: 'This recap isn’t shared' })));

await browser.close();
await db.end();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
