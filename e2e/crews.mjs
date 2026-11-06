// Walks the crew flows in real browsers, with several people at once. `make e2e`
// runs it against a private server. It needs that server's DATABASE_URL and
// SESSION_KEY, because accounts are made directly: see mint-account/mint.mjs.
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { mintAccount } from './mint-account/mint.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:18082';
const OUT = process.argv[2] ?? '.';
const SAMPLE = `${BASE}/sample.mp4`;
const INVITE_BUDGET_MS = 10_000;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}  ${detail}`);
};

/** Someone in their own browser. Named people are signed in, and null is a guest. */
const person = async (name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const account = name ? await mintAccount(name) : null;
  if (account) await context.addCookies([{ name: 's2g_session', value: account.cookie, url: BASE }]);
  const page = await context.newPage();
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
  return { page, context, account };
};

const sockets = ({ page }) =>
  page.evaluate(() => ({ made: window.__sockets.length, open: window.__sockets.filter((s) => s.readyState === 1).length }));

const button = ({ page }, name) => page.getByRole('button', { name });
const visible = (locator, timeout = 5000) => locator.waitFor({ timeout }).then(() => true, () => false);

const startCrew = async (who, name) => {
  await who.page.goto(BASE);
  await button(who, 'Start a crew').click();
  await who.page.fill('#crew-name', name);
  await who.page.keyboard.press('Enter');
  await who.page.waitForURL(/\/r\//);
};

const enter = async (who) => {
  await button(who, /Join the room|Be the first in/).click();
  await who.page.getByRole('tab', { name: 'People' }).waitFor();
};

// Create, then invite: the first ten seconds.
const hana = await person('Hana');
const started = Date.now();
await startCrew(hana, 'Sundays');
await button(hana, 'Copy').click();
const inviteMs = Date.now() - started;
const invite = await hana.page.evaluate(() => navigator.clipboard.readText());
check('create to invite copied', inviteMs < INVITE_BUDGET_MS && invite.includes('?join='), `${inviteMs} ms`);
check('invite link selected on arrival', await hana.page.locator('#crew-invite').inputValue() === invite, invite.replace(/join=.*/, 'join=…'));
check('sole member sees the empty state', await visible(hana.page.getByText('It’s just you. Copy the invite.')));
check('empty watchlist says so', await visible(hana.page.getByText('Add something for next time.')));

// A friend takes the invite.
const mika = await person('Mika');
await mika.page.goto(invite);
await button(mika, 'Join the crew').click();
check('joining opens the home', await visible(button(mika, /Join the room|Be the first in/)));
check('the crew reads as a crew', await visible(mika.page.getByText('Your crew')));
check('an empty room asks for someone to go first', await visible(button(mika, 'Be the first in')) && !(await mika.page.locator('body').innerText()).includes('Nobody’s in'));
await mika.page.setViewportSize({ width: 1440, height: 779 });
const beside = await mika.page.evaluate(() => {
  const [door, nights] = ['.crew-door', '.crew-nights'].map((part) => document.querySelector(part).getBoundingClientRect());
  return nights.left - door.right;
});
check('a wide page puts the nights beside the door', beside > 0, String(beside));
await mika.page.setViewportSize({ width: 1280, height: 800 });
check('joining strips the token', !mika.page.url().includes('join='), mika.page.url());
const crewSeats = mika.page.getByRole('list', { name: 'The crew' });
check('everyone on the crew keeps a seat', (await crewSeats.innerText()).includes('Hana') && (await crewSeats.innerText()).includes('Mika'));
check('nobody in is shown as away', (await crewSeats.locator('.seat[data-away="true"]').count()) === 2);
await hana.page.reload();
await button(hana, 'Members and settings').click();
check('the owner sees the new member', await visible(hana.page.getByRole('list').getByText('Mika')));
await button(hana, 'Sundays').click();
await hana.page.screenshot({ path: `${OUT}/crew-home.png`, fullPage: true });

// A guest gets today's flow and one more line.
const guest = await person(null);
await guest.page.goto(invite);
check('a visitor is told what they get', await visible(guest.page.getByText(/You can watch, chat and react tonight/)));
await guest.page.screenshot({ path: `${OUT}/crew-gate.png` });
await guest.page.getByRole('button', { name: 'Take your seat', exact: true }).click();
check('guest reaches the room', await visible(guest.page.getByRole('tab', { name: 'People' })));
await guest.context.close();

// The watchlist goes from the home into the room's queue.
await hana.page.fill('#crew-watchlist', SAMPLE);
await hana.page.keyboard.press('Enter');
check('a link joins the watchlist', await visible(hana.page.getByRole('button', { name: 'Remove sample' })), 'sample');
await mika.page.reload();
check('a friend sees who added it', await visible(mika.page.getByText('Added by Hana')));
await mika.page.screenshot({ path: `${OUT}/crew-home-friend.png`, fullPage: true });
check('nobody is credited for their own', (await hana.page.getByText(/^Added by/).count()) === 0);
await enter(hana);
await hana.page.getByRole('region', { name: 'Your watchlist' }).getByRole('listitem').first().hover();
await hana.page.getByRole('region', { name: 'Your watchlist' }).getByRole('button', { name: 'Add: sample' }).click();
check('the watchlist plays through the queue', await visible(hana.page.locator('video')));
await hana.page.getByRole('link', { name: 'Crew home' }).click();
await button(hana, 'Members and settings').click();
check('crew home leaves the room', await visible(hana.page.getByRole('switch', { name: 'Anyone with the link can come in' })));

// Members only: the owner shuts the door, and a guest can't get in.
await button(hana, 'Anyone with the link can come in').or(hana.page.getByRole('switch', { name: 'Anyone with the link can come in' })).first().click();
await sleep(300);
const shut = await person(null);
await shut.page.goto(hana.page.url());
check('members only says whose room it is', await visible(shut.page.getByText('This room is for its crew. Ask them for an invite.')));
check('members only has no guest way in', (await shut.page.getByRole('button', { name: 'Take your seat', exact: true }).count()) === 0);
await shut.context.close();

// Removing someone ends the old invite.
await hana.page.reload();
await button(hana, 'Members and settings').click();
await button(hana, 'Actions for Mika').click();
await button(hana, 'Remove').filter({ hasText: /^Remove$/ }).click();
await hana.page.getByRole('button', { name: 'Remove Mika?' }).click();
await sleep(300);
const stale = await mika.page.evaluate((link) => fetch(`/v1/crews/${new URL(link).pathname.split('/')[2]}/join`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: new URL(link).searchParams.get('join') }),
}).then((reply) => reply.status), invite);
check('removing a member rotates the invite', stale === 403, `old token answered ${stale}`);

// Keeping a room: nobody moves and nobody reconnects.
const host = await person('Ren');
await host.page.goto(BASE);
await host.page.fill('#link', SAMPLE);
await host.page.click('button[type=submit]');
await host.page.waitForURL(/\/r\//);
const roomUrl = host.page.url();
const friend = await person('Sol');
const passerby = await person(null);
for (const viewer of [friend, passerby]) {
  await viewer.page.goto(roomUrl);
  await button(viewer, 'Take your seat').click();
  await viewer.page.getByRole('tab', { name: 'People' }).waitFor();
}
await sleep(500);
const before = await Promise.all([host, friend, passerby].map(sockets));
await button(host, 'Keep this room').click();
const offer = friend.page.getByRole('button', { name: /Join to keep it/ });
check('others are offered the crew', await visible(offer));
const after = await Promise.all([host, friend, passerby].map(sockets));
check('promoted room keeps its address', host.page.url() === roomUrl, roomUrl);
check('promoted room keeps every connection', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
await offer.click();
check('joining from inside the room', await visible(friend.page.getByRole('link', { name: 'Crew home' })));
check('the owner has the way home', await visible(host.page.getByRole('link', { name: 'Crew home' })));
const still = await sockets(friend);
check('joining from inside keeps the connection', still.made === before[1].made && still.open === 1, JSON.stringify(still));
await button(host, 'Invite').first().click();
const kept = await host.page.evaluate(() => navigator.clipboard.readText());
check('a member’s Invite carries the join link', kept.includes('?join='), kept.replace(/join=.*/, 'join=…'));

// A phone has the least room for the header, so leave a picture of it.
await host.page.setViewportSize({ width: 390, height: 844 });
await sleep(300);
await host.page.screenshot({ path: `${OUT}/crew-room-phone.png` });
await friend.page.getByRole('link', { name: 'Crew home' }).click();
await friend.page.setViewportSize({ width: 390, height: 844 });
await button(friend, /Join the room|Be the first in/).waitFor();
await friend.page.screenshot({ path: `${OUT}/crew-home-phone.png`, fullPage: true });

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:\n${failures.join('\n')}`);
  process.exit(1);
}
