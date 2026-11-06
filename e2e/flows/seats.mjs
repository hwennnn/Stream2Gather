// The seats, the way out and the way back.
import { addByMessage, joinRoom, openTab, reenter, startRoom, ui } from '../lib/app.mjs';
import { crowd } from '../lib/bots.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');

const seats = (page) => page.getByRole('list', { name: 'In the room' }).filter({ visible: true }).first();

flow('seats: everyone keeps their seat, and the status line says who came and went', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const c = await t.person('Cal');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.see('Ana hears Ben sit', ui.bar(a.page).getByText(/Ben took a seat/));
  await joinRoom(c, room.url);
  const order = () => seats(a.page).getByRole('listitem').allInnerTexts();
  const names = (rows) => rows.map((row) => row.split('\n').at(-1)).filter(Boolean);
  const initials = (rows) => rows.map((row) => row.split('\n')[0]);
  await t.until('Cal on the row', async () => initials(await order()).includes('C'));
  const before = names(await order());
  const seatOfCal = initials(await order()).indexOf('C');
  t.check('you are You', before.includes('You'), before.join(', '));
  await b.page.goto('about:blank');
  await t.see('Ana hears Ben go', ui.bar(a.page).getByText(/Ben stepped out/), 8000);
  await t.gone('Ben off the row, or dimmed', seats(a.page).locator('[data-away=false]').getByText('Ben'), 12_000);
  t.eq('Cal has not moved', initials(await order()).indexOf('C'), seatOfCal);
});

flow('seats: a full row says how many more, and that opens People', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const bots = await crowd(t, room.slug, 14);
  const more = a.page.getByRole('button', { name: /\d+ more people/ }).filter({ visible: true }).first();
  await t.see('how many more', more, 8000);
  await more.click();
  await t.see('the whole list', ui.rail(a.page).getByRole('listitem').filter({ hasText: 'Guest 14' }));
  const row = a.page.getByRole('list', { name: 'In the room' }).filter({ visible: true });
  const invite = row.getByRole('button', { name: 'Invite' });
  await t.see('Invite stays beside the count', invite);
  t.check('and all of it is inside the row', await invite.evaluate((button) => {
    const seats = button.closest('ul').getBoundingClientRect();
    return button.getBoundingClientRect().right <= seats.right + 0.5;
  }));
  bots.forEach((bot) => bot.close());
});

flow('track: one dot each, a friend behind sits behind, and the player does not move', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a);
  await addByMessage(t, a.page, [golden.url]);
  await joinRoom(b, room.url);
  const dots = a.page.locator('.front-row .seat-track-dot');
  await t.until('a dot each', async () => (await dots.count()) === 2);
  await t.see('the room clock', a.page.locator('.front-row .seat-track').getByText(/^\d+:\d\d$/));
  const box = () => a.page.locator('[data-player]').evaluate((node) => JSON.stringify(node.getBoundingClientRect()));
  const before = await box();
  const lefts = () => dots.evaluateAll((list) => list.map((dot) => dot.getBoundingClientRect().left).sort((x, y) => x - y));
  const together = await lefts();
  t.check('together, side by side', together[1] - together[0] < 24, together.join());
  await b.page.evaluate(() => window.__net.send('status', { state: 'correcting', drift: -12 }));
  await t.until('Ben falls behind on the track', async () => {
    const [behind = 0, here = 0] = await lefts();
    return here - behind > 100;
  });
  t.eq('the player did not move', await box(), before);
  const clear = await a.page.evaluate(() => document.querySelector('.front-row .seat-track').getBoundingClientRect().top >= document.querySelector('[data-player]').getBoundingClientRect().bottom);
  t.check('the track is off the player', clear);
});

flow('leave: Leave goes home, the room hears, and the landing offers the way back', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await b.page.getByRole('link', { name: 'Leave', exact: true }).click();
  await t.see('home', ui.linkBox(b.page));
  await t.see('Ana hears', ui.chatLog(a.page).getByText('Ben left'), 12_000);
  const back = b.page.getByRole('link', { name: /Back to/ });
  await t.see('the way back', back);
  await back.click();
  await reenter(b.page);
  await t.see('in again', ui.bar(b.page).getByRole('heading', { name: golden.title }));
});

flow('leave: a room that has since closed offers no way back to it', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  await a.page.getByRole('link', { name: 'Leave', exact: true }).click();
  await t.see('the way back', a.page.getByRole('link', { name: /Back to/ }));
  await t.stack.sql(`UPDATE rooms SET closed_at = now() WHERE slug = '${room.slug}'`);
  await a.page.reload();
  await t.see('home', ui.linkBox(a.page));
  await t.gone('the way back', a.page.getByRole('link', { name: /Back to/ }));
});

const firstThumb = (strip) => strip.locator('.up-next-thumb').first().evaluate((thumb) => Math.round(thumb.getBoundingClientRect().left));

flow('dock: Popular and Up next share one geometry, and watching never swaps them', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a);
  const popular = a.page.locator('main section[aria-label="Popular on YouTube"]');
  const pick = popular.getByRole('button', { name: new RegExp(train.title) }).first();
  await t.see('a suggestion with nothing on', pick);
  const popularX = await firstThumb(popular);
  await pick.click();
  await t.gone('it plays, so suggestions go', popular);
  await addByMessage(t, a.page, [golden.url]);
  const upNext = a.page.getByRole('region', { name: 'Up next in the queue' });
  await t.see('it is queued', upNext.getByRole('listitem').filter({ hasText: golden.title }));
  t.eq('the first thumbnail starts at the same x', await firstThumb(upNext), popularX);
  await openTab(a.page, 'Queue');
  await t.see('Up next stays with the queue open', upNext.getByRole('listitem').filter({ hasText: golden.title }));
  t.eq('and Popular does not come back', await popular.count(), 0);
});

flow('links: a catch-up link lands somewhere until that page exists, and a dead recap link says so', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben');
  await b.page.goto(`${t.base}/r/${room.slug}/catchup/nothing`);
  await t.see('the gate', ui.join(b.page));
  await b.page.goto(`${t.base}/s/no-such-token`);
  await t.see('a recap that is not shared', b.page.getByRole('heading', { name: /recap isn.t shared/ }));
});
