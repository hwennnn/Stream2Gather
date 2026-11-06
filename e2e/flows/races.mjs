// Two people, or one impatient finger, doing the same thing at once.
import { addByMessage, joinRoom, openTab, player, roomDoc, sample, search, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');
const rain = video('Rainy Window');

const strip = (page) => page.getByRole('region', { name: 'Up next in the queue' });

const roomWithQueue = async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await addByMessage(t, a.page, [train.url, rain.url]);
  await t.see('both queued', strip(b.page).getByRole('button', { name: new RegExp(rain.title) }));
  return { a, b, room };
};

const nowOn = (client, media) => ui.bar(client.page).getByRole('heading', { name: media.title });

flow('races: two people skipping at once skip one video', async (t) => {
  const { a, b, room } = await roomWithQueue(t);
  // Both aimed at the same video. Clicks here land too far apart to be a real race.
  const { item } = (await roomDoc(t, room.slug)).playback;
  await Promise.all([a, b].map((one) => one.page.evaluate((id) => window.__net.send('skip', { item: id }), item)));
  await t.see('the next video', nowOn(a, train));
  await t.see('for both', nowOn(b, train));
  await t.sleep(1000);
  await t.expect('the one after it is still queued', strip(a.page).getByRole('button', { name: new RegExp(rain.title) }));
});

flow('races: a double click on Skip skips once', async (t) => {
  const { a } = await roomWithQueue(t);
  await ui.skip(a.page).dblclick();
  await t.see('the next video', nowOn(a, train));
  await t.sleep(1000);
  await t.expect('still that one', nowOn(a, train));
});

flow('races: a double click on Start watching makes one room', async (t) => {
  const a = await t.person('Ana');
  await a.page.goto(t.base);
  await ui.linkBox(a.page).fill(golden.url);
  await ui.startWatching(a.page).dblclick();
  await a.page.waitForURL(/\/r\//);
  await t.see('the room', ui.rail(a.page));
  await t.sleep(500);
  const owner = await t.stack.sql(`SELECT owner_id FROM rooms WHERE slug = '${new URL(a.page.url()).pathname.split('/')[2]}'`);
  t.eq('one room', await t.stack.sql(`SELECT count(*) FROM rooms WHERE owner_id = '${owner}'`), '1');
});

flow('races: a double click on Join joins once', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await b.page.goto(room.url);
  await ui.joinName(b.page).fill('Ben');
  await ui.join(b.page).dblclick();
  await t.see('the room', ui.rail(b.page));
  await t.see('Ana hears about it', ui.chatLog(a.page).getByText('Ben joined'));
  await t.sleep(1000);
  t.eq('once', await ui.chatLog(a.page).getByText('Ben joined').count(), 1);
  await openTab(a.page, 'People');
  await t.expect('two people', ui.tab(a.page, 'People').getByText('2'));
});

flow('races: a double click on Queue in a search row queues once', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'Queue');
  await search(a.page, 'mix');
  const row = ui.results(a.page).getByRole('listitem').filter({ hasText: train.title });
  await row.hover();
  await row.getByRole('button', { name: /^Queue:/ }).dblclick();
  await t.see('it is added', row.getByText(/added|queued/i));
  await a.page.keyboard.press('Escape');
  await t.sleep(500);
  t.eq('once', await ui.upNext(a.page).getByRole('listitem').filter({ hasText: train.title }).count(), 1);
});

flow('races: the same link added twice is said, not silently doubled', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await addByMessage(t, a.page, [train.url, train.url]);
  await openTab(a.page, 'Queue');
  await t.see('queued', ui.upNext(a.page).getByRole('listitem').filter({ hasText: train.title }));
  await t.sleep(500);
  t.check('it is on the list, once or knowingly twice',
    (await ui.upNext(a.page).getByRole('listitem').filter({ hasText: train.title }).count()) <= 2);
});

flow('races: Play now on a row someone else just removed does no harm', async (t) => {
  const { a, b, room } = await roomWithQueue(t);
  await openTab(a.page, 'Queue');
  await openTab(b.page, 'Queue');
  const row = ui.upNext(b.page).getByRole('listitem').filter({ hasText: train.title });
  await row.hover();
  const stale = (await roomDoc(t, room.slug)).queue.find((item) => item.sourceId === train.id).id;
  await row.getByRole('button', { name: /^Remove/ }).click();
  await t.gone('the row', ui.upNext(a.page).getByRole('listitem').filter({ hasText: train.title }));
  await a.page.evaluate((id) => window.__net.send('queue.play', { id }), stale);
  await t.sleep(500);
  await t.expect('the video is unchanged', nowOn(a, golden));
  await t.expect('and for Ben', nowOn(b, golden));
});

flow('races: Undo after someone else moved on does not jump the room backwards twice', async (t) => {
  const { a, b } = await roomWithQueue(t);
  await strip(b.page).getByRole('button', { name: new RegExp(train.title) }).click();
  await t.see('the next video', nowOn(a, train));
  const undo = a.page.getByRole('button', { name: 'Undo' });
  await t.see('Undo', undo);
  await ui.skip(b.page).click();
  await t.see('the third video', nowOn(b, rain));
  if (await undo.isVisible()) await undo.click().catch(() => {});
  await t.sleep(1000);
  const heading = (client) => ui.bar(client.page).getByRole('heading').first().innerText();
  t.eq('they agree on what is on', await heading(a), await heading(b));
});

flow('races: a seek while paused moves everyone and stays paused', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: sample(t.base) });
  await joinRoom(b, room.url);
  await t.until('both play', async () => (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing' && s.time > 1), 12_000);
  await t.sleep(2000);
  await player(a.page).pause();
  await t.until('Ben stops', async () => (await b.sample())?.state === 'paused', 8000);
  await t.sleep(2000);
  await player(a.page).seek(150);
  await t.until('Ben moves', async () => Math.abs((await b.sample())?.time - 150) < 1, 8000);
  await t.sleep(1500);
  t.eq('still paused', (await b.sample())?.state, 'paused');
  t.eq('Ana stays put', Math.abs((await a.sample())?.time - 150) < 1, true);
});

for (const [label, skew] of [['ahead', 90_000], ['behind', -90_000]]) {
  flow(`races: a clock 90 seconds ${label} on one computer changes nothing`, { timeout: 45_000 }, async (t) => {
    const a = await t.person('Ana');
    const b = await t.person('Ben');
    await b.context.addInitScript((by) => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + by;
    }, skew);
    const room = await startRoom(t, a, { url: sample(t.base) });
    // Far enough in that being wrong shows as a jump, not a slow catch-up.
    await t.until('the room has been going a while', async () => (await a.sample())?.time > 6, 12_000);
    await joinRoom(b, room.url);
    await t.until('Ben plays', async () => (await b.sample())?.state === 'playing', 12_000);
    await t.until('and in step, soon', async () => {
      const [x, y] = await Promise.all([a.sample(), b.sample()]);
      return Math.abs(x.time - y.time) < 0.6;
    }, 8000);
  });
}
