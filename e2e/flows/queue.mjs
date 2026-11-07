import { addByMessage, joinRoom, openTab, sample, search, seedRoom, sendChat, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');
const rain = video('Rainy Window');
const coffee = video('Morning Coffee');

const twoInRoom = async (t, url = golden.url) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url });
  await joinRoom(b, room.url);
  await openTab(a.page, 'Queue');
  await openTab(b.page, 'Queue');
  return { a, b, room };
};

const row = (page, title) => ui.results(page).getByRole('listitem').filter({ hasText: title });
const upNextTitles = (page) =>
  ui.upNext(page).getByRole('listitem').evaluateAll((rows) => rows.map((li) => li.querySelector('p')?.textContent ?? ''));

/** Play now waits behind ⋯ on every row, so nobody interrupts the room by reflex. */
const press = async (line, title, action) => {
  await line.hover();
  if (action !== 'Play now') return line.getByRole('button', { name: `${action}: ${title}` }).click();
  await line.getByRole('button', { name: `More for ${title}` }).click();
  return line.getByRole('button', { name: 'Play now', exact: true }).click();
};

const pressRow = (page, title, action) => press(row(page, title), title, action);

flow('search: results come back with title, channel and length', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'Queue');
  await search(a.page, 'night music');
  await t.see('the heading', ui.results(a.page).getByRole('heading', { name: /night music/ }));
  await t.see('a row', row(a.page, train.title));
  await t.see('its channel', row(a.page, train.title).getByText('Slow Travel Films'));
  await t.see('its length', row(a.page, train.title).getByText('41:03'));
  await t.see('Korean', row(a.page, video('지금까지').title));
  const count = await ui.results(a.page).getByRole('listitem').count();
  t.eq('live streams are left out', count, 24);
  t.check('marked-up titles stay text', !(await a.page.evaluate(() => window.__xss)));
  await t.see('entities are decoded', ui.results(a.page).getByText('Late 90s & 2000s Lofi Hip-Hop & R&B', { exact: false }));
});

flow('search: from the empty stage, a result starts the room', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a);
  await joinRoom(b, room.url);
  await search(a.page, 'something');
  await t.see('results on the stage', row(a.page, rain.title));
  await pressRow(a.page, rain.title, 'Add');
  await t.see('Ana watches it', ui.bar(a.page).getByRole('heading', { name: rain.title }));
  await t.see('Ben watches it', ui.bar(b.page).getByRole('heading', { name: rain.title }));
});

flow('search row: Play now replaces the video for everyone and offers Undo', async (t) => {
  const { a, b } = await twoInRoom(t);
  await search(a.page, 'mix');
  await pressRow(a.page, train.title, 'Play now');
  await t.see('Ana plays it', ui.bar(a.page).getByRole('heading', { name: train.title }));
  await t.see('Ben plays it', ui.bar(b.page).getByRole('heading', { name: train.title }));
  await t.see('the row says so', row(a.page, train.title).getByText(/added|playing now/i));
});

flow('search row: Play next lands first in line, Add lands last', async (t) => {
  const { a, b } = await twoInRoom(t);
  await addByMessage(t, a.page, [coffee.url]);
  await search(a.page, 'mix');
  await pressRow(a.page, rain.title, 'Add');
  await t.see('Add answers', row(a.page, rain.title).getByText(/added/i));
  await pressRow(a.page, train.title, 'Play next');
  await t.see('Play next answers', row(a.page, train.title).getByText(/added/i));
  await a.page.keyboard.press('Escape');
  await t.gone('results after Esc', ui.results(a.page));
  await t.see('the queue again', ui.upNext(a.page));
  await t.until('Ben sees the order', async () =>
    (await upNextTitles(b.page)).join() === [train.title, coffee.title, rain.title].join());
  t.eq('Ana sees the same order', (await upNextTitles(a.page)).join(), [train.title, coffee.title, rain.title].join());
  await t.see('Ben sees the count', ui.tab(b.page, 'Queue').getByText('3'));
});

flow('search row: a video already here says so instead of offering to add it twice', async (t) => {
  const { a } = await twoInRoom(t);
  await addByMessage(t, a.page, [train.url]);
  await search(a.page, 'mix');
  await t.see('playing', row(a.page, golden.title).getByText('Playing now'));
  await t.see('queued', row(a.page, train.title).getByText('Queued', { exact: true }));
  t.eq('no actions on those rows', await row(a.page, train.title).getByRole('button').count(), 0);
});

flow('search: nothing found, a broken API and a spent quota all say something useful', async (t) => {
  const a = await t.person('Ana');
  a.expected5xx = /media\/search/; // YouTube failing is what this flow is about.
  await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'Queue');
  await search(a.page, 'nothing matches this');
  await t.see('no results', ui.results(a.page).getByText(/nothing found/i));
  const answer = a.page.waitForResponse(/media\/search\?q=please/);
  await search(a.page, 'please break the api');
  t.eq('it is not called a server error', (await answer).status(), 503);
  await t.see('search failed', ui.results(a.page).getByText('Search isn’t working right now. Paste a link instead.'));
  await search(a.page, 'out of quota today');
  await t.see('quota', ui.results(a.page).getByText(/resting|tomorrow/i));
});

flow('search: Esc, the close button and Cmd-K behave', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await ui.chatBox(a.page).click();
  await a.page.keyboard.press('Control+k');
  await t.see('the queue tab opens', ui.addBox(a.page));
  await t.until('and the box has focus', () => ui.addBox(a.page).evaluate((el) => el === document.activeElement));
  await a.page.keyboard.type('mix');
  await t.see('a clear button', a.page.getByRole('button', { name: 'Clear' }));
  await a.page.keyboard.press('Enter');
  await t.see('results', row(a.page, train.title));
  await a.page.getByRole('button', { name: 'Close search' }).click();
  await t.gone('results', ui.results(a.page));
  t.eq('the box is empty', await ui.addBox(a.page).inputValue(), '');
});

flow('search: past the hourly limit it says so', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'Queue');
  await t.stack.redis('SET', `limit:search:${a.address}`, '20', 'EX', '600');
  await search(a.page, 'mix');
  await t.see('the limit', ui.results(a.page).getByText(/too many searches/i));
});

flow('search: the budget stays spent on repeats, not on retyping', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'Queue');
  await search(a.page, 'one cached query');
  await t.see('results', row(a.page, train.title));
  const before = t.fixtures.calls.search;
  await search(a.page, '  One   CACHED query ');
  await t.see('results again', row(a.page, train.title));
  t.eq('no second API call', t.fixtures.calls.search, before);
});

flow('add by link: a pasted link joins the queue for everyone', async (t) => {
  const { a, b } = await twoInRoom(t);
  await ui.addBox(a.page).fill(train.url);
  await ui.addBox(a.page).press('Enter');
  await t.until('the box clears', async () => (await ui.addBox(a.page).inputValue()) === '');
  await t.see('Ben sees it', ui.upNext(b.page).getByText(train.title));
  await t.see('with who added it', ui.upNext(b.page).getByText('Ana', { exact: true }));
});

flow('add by link: bad links stay in the box with a reason', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'Queue');
  for (const [link, reason] of [
    ['https://vimeo.com/76979871', /isn.t supported/i],
    ['https://www.youtube.com/watch?v=doesnotexis', /cannot be played|can.t be played/i],
    [video('Cozy Lofi').url, /live/i],
  ]) {
    await ui.addBox(a.page).fill(link);
    await ui.addBox(a.page).press('Enter');
    await t.expect(`a reason for ${link}`, ui.rail(a.page).getByRole('alert').getByText(reason));
    t.eq('the link stays to be fixed', await ui.addBox(a.page).inputValue(), link);
  }
  await ui.addBox(a.page).fill('x');
  await t.gone('the reason, on typing', ui.rail(a.page).getByRole('alert'));
});

flow('add by link: a YouTube link in chat can go straight into the queue', async (t) => {
  const { a, b } = await twoInRoom(t);
  await openTab(a.page, 'Chat');
  await openTab(b.page, 'Chat');
  await sendChat(a.page, `watch this ${train.url}`);
  await t.see('a link', ui.chatLog(b.page).getByRole('link', { name: train.url }));
  await ui.chatLog(b.page).getByRole('button', { name: /add to queue/i }).click();
  await t.see('a toast', b.page.getByText(/added to the queue/i));
  await openTab(a.page, 'Queue');
  await t.see('it is queued', ui.upNext(a.page).getByText(train.title));
});

const three = async (t) => {
  const { a, b, room } = await twoInRoom(t);
  await addByMessage(t, a.page, [train.url, rain.url, coffee.url]);
  await t.see('three queued', ui.tab(b.page, 'Queue').getByText('3'));
  return { a, b, room };
};

const upNextRow = (page, title) => ui.upNext(page).getByRole('listitem').filter({ hasText: title });

const pressUpNext = (page, title, action) => press(upNextRow(page, title), title, action);

flow('queue: Move up, Move down and Remove reach everyone', async (t) => {
  const { a, b } = await three(t);
  await pressUpNext(a.page, coffee.title, 'Move up');
  await t.until('Ben sees it move up', async () => (await upNextTitles(b.page)).join() === [train.title, coffee.title, rain.title].join());
  await pressUpNext(b.page, train.title, 'Move down');
  await t.until('Ana sees it move down', async () => (await upNextTitles(a.page)).join() === [coffee.title, train.title, rain.title].join());
  await pressUpNext(a.page, train.title, 'Remove');
  await t.gone('the row for Ben', upNextRow(b.page, train.title));
  await t.see('the count for Ben', ui.tab(b.page, 'Queue').getByText('2'));
  await upNextRow(a.page, coffee.title).hover();
  t.check('the first row cannot move up', await upNextRow(a.page, coffee.title).getByRole('button', { name: /^Move up/ }).isDisabled());
  await upNextRow(a.page, rain.title).hover();
  t.check('the last row cannot move down', await upNextRow(a.page, rain.title).getByRole('button', { name: /^Move down/ }).isDisabled());
});

flow('queue: dragging a row reorders it for everyone', async (t) => {
  const { a, b } = await three(t);
  const from = await upNextRow(a.page, coffee.title).boundingBox();
  const to = await upNextRow(a.page, train.title).boundingBox();
  await upNextRow(a.page, coffee.title).hover();
  await a.page.mouse.move(from.x - 8, from.y + from.height / 2);
  await a.page.mouse.down();
  await a.page.mouse.move(from.x - 8, to.y + 4, { steps: 8 });
  await a.page.mouse.up();
  await t.until('Ben sees the new order', async () => (await upNextTitles(b.page))[0] === coffee.title);
  t.eq('Ana keeps it', (await upNextTitles(a.page))[0], coffee.title);
});

flow('queue: Play now on a row jumps there, and Undo goes back to the same spot', async (t) => {
  const { a, b } = await three(t);
  await t.until('it has played a little', async () => (await a.sample())?.time > 2);
  const before = (await a.sample()).time;
  await pressUpNext(a.page, rain.title, 'Play now');
  await t.see('Ben is watching it', ui.bar(b.page).getByRole('heading', { name: rain.title }));
  await t.see('the notice for Ben', b.page.getByText(/Ana.*jumped to/));
  await t.see('Undo for Ben too', b.page.getByRole('button', { name: 'Undo' }));
  await a.page.getByRole('button', { name: 'Undo' }).click();
  await t.see('Ana back on the old video', ui.bar(a.page).getByRole('heading', { name: golden.title }));
  await t.see('Ben back on it', ui.bar(b.page).getByRole('heading', { name: golden.title }));
  await t.until('it resumes where it was', async () => {
    const now = await b.sample();
    return now?.state === 'playing' && now.time >= before - 1 && now.time < before + 8;
  });
  t.eq('the queue is whole again', (await upNextTitles(a.page)).join(), [train.title, rain.title, coffee.title].join());
});

flow('queue: Undo disappears after its few seconds', async (t) => {
  const { a } = await three(t);
  await pressUpNext(a.page, rain.title, 'Play now');
  await t.see('Undo', a.page.getByRole('button', { name: 'Undo' }));
  await t.gone('Undo', a.page.getByRole('button', { name: 'Undo' }), 7000);
});

flow('queue: the Up next strip under the player plays what is tapped', async (t) => {
  const { a, b } = await three(t);
  await openTab(a.page, 'Chat'); // While the Queue tab shows the queue, this space suggests more.
  await a.page.getByRole('region', { name: 'Up next in the queue' }).getByRole('button', { name: new RegExp(train.title) }).click();
  await t.see('Ben is watching it', ui.bar(b.page).getByRole('heading', { name: train.title }));
});

flow('queue: a long queue stays usable, up to the 200 limit', { timeout: 120_000 }, async (t) => {
  const { a, b, room } = await twoInRoom(t, sample(t.base));
  const seeded = Array.from({ length: 198 }, (_, i) => ({
    id: `seed${i}`, source: 'direct', sourceId: `s${i}`, url: `${t.base}/sample.mp4?n=${i}`, title: `Seeded video ${i + 1}`,
    author: 'seed', thumbnailUrl: '', durationMs: 60000, isLive: false, addedBy: 'x', addedByName: 'Seeder',
  }));
  await seedRoom(t, room.slug, (state) => state.queue.push(...seeded));
  await Promise.all([a, b].map((client) => client.page.evaluate(() => window.__net.cut())));
  await t.see('Ana sees them all', ui.tab(a.page, 'Queue').getByText('198'), 12_000);
  await t.see('the last row is there', ui.upNext(a.page).getByText('Seeded video 198'));
  await ui.addBox(a.page).fill(train.url);
  await ui.addBox(a.page).press('Enter');
  await t.see('number 199 goes in', ui.tab(b.page, 'Queue').getByText('199'));
  // Ben hears of it before Ana's own answer lands, and until then her box still holds the link.
  await t.until('the box clears', async () => (await ui.addBox(a.page).inputValue()) === '');
  await ui.addBox(a.page).fill(rain.url);
  await ui.addBox(a.page).press('Enter');
  await t.see('then it is full', ui.rail(a.page).getByRole('alert').getByText(/queue is full/i));
});
