import { joinRoom, openTab, reenter, startRoom, ui } from '../lib/app.mjs';
import { crowd } from '../lib/bots.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');

const newRoomButton = (page) => page.getByRole('button', { name: /start a new room/i });

flow('room full: the 51st person gets a straight answer and a way forward', { timeout: 60_000 }, async (t) => {
  const host = await t.person('Hana');
  const room = await startRoom(t, host, { url: golden.url });
  const bots = await crowd(t, room.slug, 49);
  await openTab(host.page, 'People');
  await t.see('50 in the room', ui.tab(host.page, 'People').getByText('50'), 10_000);
  const late = await t.person('Late');
  await late.page.goto(room.url);
  await t.see('the answer', late.page.getByRole('heading', { name: /this room is full/i }));
  await t.see('who has the seats', late.page.getByRole('list', { name: 'Seats' }).getByText('+'));
  await t.see('the way forward', late.page.getByRole('button', { name: 'Check for a seat' }));
  t.eq('no Join on offer', await ui.join(late.page).count(), 0);
  t.eq('no new room to split the group', await newRoomButton(late.page).count(), 0);

  await host.page.reload();
  await reenter(host.page);
  await t.see('someone already in can come back', ui.bar(host.page));

  bots[0].close();
  await late.page.reload();
  await t.see('a free seat opens the gate', ui.join(late.page), 10_000);
  bots.forEach((one) => one.close());
});

flow('room full: filling up between the gate and Join is explained', async (t) => {
  const host = await t.person('Hana');
  const room = await startRoom(t, host);
  const late = await t.person('Late');
  await late.page.goto(room.url);
  await t.see('Join', ui.join(late.page));
  await t.stack.sql(`UPDATE rooms SET max_members = 1 WHERE slug = '${room.slug}'`);
  await ui.join(late.page).click();
  await t.see('the answer', late.page.getByRole('heading', { name: /this room is full/i }));
  await t.see('the way forward', late.page.getByRole('button', { name: 'Check for a seat' }));
});

flow('dead room: a closed room says so and starts another', async (t) => {
  const host = await t.person('Hana');
  const room = await startRoom(t, host);
  await t.stack.sql(`UPDATE rooms SET closed_at = now() WHERE slug = '${room.slug}'`);
  const late = await t.person('Late');
  await late.page.goto(room.url);
  await t.see('the answer', late.page.getByRole('heading', { name: /room.s night is over/i }));
  await newRoomButton(late.page).click();
  await t.see('a new room', ui.rail(late.page));
  await t.check('at a new address', late.page.url() !== room.url);
});

flow('dead room: closing under people ends it cleanly on their next connect', async (t) => {
  const host = await t.person('Hana');
  const room = await startRoom(t, host, { url: golden.url });
  await t.stack.sql(`UPDATE rooms SET closed_at = now() WHERE slug = '${room.slug}'`);
  await host.page.evaluate(() => window.__net.cut());
  await t.see('the answer', host.page.getByRole('heading', { name: /room.s night is over/i }), 10_000);
});

flow('dead room: a closed room says who was there', async (t) => {
  const host = await t.person('Hana');
  const room = await startRoom(t, host);
  const friend = await t.person('Mika');
  await friend.page.goto(room.url);
  await ui.join(friend.page).click();
  await t.see('the room', ui.rail(friend.page));
  await t.see('Hana in it', ui.tab(friend.page, 'People'));
  await t.stack.sql(`UPDATE rooms SET closed_at = now() WHERE slug = '${room.slug}'`);
  await friend.page.reload();
  await t.see('the answer', friend.page.getByRole('heading', { name: /room.s night is over/i }));
  await t.see('who was there', friend.page.getByText(/Hana was here/));
});

flow('dead room: an unknown link says so', async (t) => {
  const { page } = await t.person('a');
  await page.goto(`${t.base}/r/no-such-room-12345`);
  await t.see('the answer', page.getByRole('heading', { name: /room doesn.t exist/i }));
  await t.see('the way forward', newRoomButton(page));
  t.eq('the tab says something', await page.title(), 'Stream2Gather');
});

flow('error pages: odd addresses still land somewhere sensible', async (t) => {
  const { page } = await t.person('a');
  for (const [path, what] of [
    ['/r/', ui.linkBox(page)],
    ['/r/a%20b%3Cscript%3E', page.getByRole('heading', { name: /room doesn.t exist/i })],
    ['/r/UPPER-case', page.getByRole('heading', { name: /room doesn.t exist/i })],
    ['/r/slug/extra/parts', page.getByRole('heading', { name: /room doesn.t exist/i })],
  ]) {
    await page.goto(`${t.base}${path}`);
    await t.expect(path, what);
  }
});

flow('error pages: a page that does not exist is not a blank screen', async (t) => {
  const { page } = await t.person('a');
  const response = await page.goto(`${t.base}/no/such/page`);
  t.eq('the address is honest about being missing', response.status(), 404);
  await t.see('it says so', page.getByRole('heading', { name: /page doesn.t exist/i }));
  await page.getByRole('link', { name: 'Go home' }).click();
  await t.see('and the way home works', ui.linkBox(page));
});

flow('error pages: a broken answer from the server hits the safety net, not a white page', async (t) => {
  const a = await t.person('a');
  a.expected5xx = /v1\/rooms/;
  await a.page.route('**/v1/rooms/broken-room', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  a.errors.length = 0;
  await a.page.goto(`${t.base}/r/broken-room`);
  await t.see('something readable', a.page.getByRole('heading').or(a.page.getByRole('button')));
  a.errors.length = 0; // A render crash logs by design here.
});

flow('error pages: a server error on the gate offers a retry', async (t) => {
  const a = await t.person('a');
  a.expected5xx = /v1\/rooms/;
  const host = await t.person('host');
  const room = await startRoom(t, host);
  await a.page.route('**/v1/rooms/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"internal","message":"x"}' }));
  await a.page.goto(room.url);
  await t.see('the answer', a.page.getByRole('heading', { name: /can.t reach this room/i }));
  await a.page.unroute('**/v1/rooms/**');
  await a.page.getByRole('button', { name: /try again/i }).click();
  await t.see('the gate', ui.join(a.page));
});

flow('error pages: too many sessions on one address is explained', async (t) => {
  const host = await t.person('host');
  const room = await startRoom(t, host);
  const a = await t.person('a');
  await t.stack.redis('SET', `limit:guest:${a.address}`, '600', 'EX', '600');
  await a.page.goto(room.url);
  await t.see('the gate', ui.join(a.page));
  await ui.join(a.page).click();
  await t.see('the reason', a.page.getByText(/too many new sessions/i));
});

flow('a joined room survives the ticket being refused for a moment', async (t) => {
  const a = await t.person('a');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('b');
  await joinRoom(b, room.url);
  await b.page.route('**/ticket', (route) => route.abort());
  await b.page.evaluate(() => window.__net.cut());
  await t.see('the bar', b.page.getByRole('status').getByText(/reconnecting/i), 3000);
  await b.page.unroute('**/ticket');
  await t.gone('the bar', b.page.getByRole('status').getByText(/reconnecting/i), 10_000);
});

flow('blocked sockets: a network that refuses WebSockets gets a way out, not a spinner', { timeout: 40_000 }, async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben');
  await b.page.routeWebSocket(/\/v1\/ws/, (socket) => socket.close());
  await b.page.goto(room.url);
  await ui.joinName(b.page).fill('Ben');
  await ui.join(b.page).click();
  await t.see('a way out', b.page.getByRole('button', { name: /try again/i }), 22_000);
});

flow('slow server: the gate is never a blank page while it loads', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben');
  await b.page.route(/\/v1\/rooms\/[^/]+$/, async (route) => {
    await t.sleep(2500);
    await route.continue();
  });
  await b.page.goto(room.url);
  await t.sleep(800);
  const words = await b.page.evaluate(() => document.body.innerText.trim().length);
  const painted = await b.page.locator('main *').count();
  t.check('something is on screen', words > 0 || painted > 2, `${words} characters, ${painted} elements`);
  await t.see('then the gate', ui.join(b.page));
});

flow('lazy code: a piece of the room that fails to load leaves the room working', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben');
  b.expectedErrors = /dynamically imported module|Failed to load resource/;
  await b.page.route(/assets\/(VoiceButton|KeepRoom)/, (route) => route.abort());
  await joinRoom(b, room.url);
  await t.see('the video', ui.bar(b.page).getByRole('heading', { name: golden.title }));
  await t.see('the chat', ui.chatBox(b.page));
});

flow('slow server: typing a name while the gate loads is not interrupted', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben');
  await b.page.route(/\/v1\/rooms\/[^/]+$/, async (route) => {
    await t.sleep(1200);
    await route.continue();
  });
  await b.page.goto(room.url);
  await ui.joinName(b.page).fill('');
  await ui.joinName(b.page).pressSequentially('Benedict Cumberbatch', { delay: 120 });
  t.eq('every letter landed', await ui.joinName(b.page).inputValue(), 'Benedict Cumberbatch');
});
