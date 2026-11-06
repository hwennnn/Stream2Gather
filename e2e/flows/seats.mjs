// The seats, the way out and the way back.
import { joinRoom, openTab, reenter, startRoom, ui } from '../lib/app.mjs';
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
  bots.forEach((bot) => bot.close());
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

flow('popular: the strip under the player adds what is tapped, and it leaves the strip', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'Queue');
  const strip = a.page.getByRole('region', { name: 'Popular on YouTube' }).filter({ visible: true }).first();
  const pick = strip.getByRole('button', { name: new RegExp(train.title) }).first();
  await t.see('a suggestion', pick);
  await pick.click();
  await t.see('it is queued', ui.upNext(a.page).getByRole('listitem').filter({ hasText: train.title }));
});

flow('links: catch-up and recap links land somewhere until those pages exist', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben');
  await b.page.goto(`${t.base}/r/${room.slug}/catchup/nothing`);
  await t.see('the gate', ui.join(b.page));
  await b.page.goto(`${t.base}/s/no-such-token`);
  await t.see('home', ui.linkBox(b.page));
});
