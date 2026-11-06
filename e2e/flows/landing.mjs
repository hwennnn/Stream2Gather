import { joinRoom, setName, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');

flow('landing: a first visit shows the pitch, the box and what is trending', async (t) => {
  const a = await t.person('a');
  await a.page.goto(t.base);
  await t.see('the headline', a.page.getByRole('heading', { level: 1 }));
  await t.see('the link box', ui.linkBox(a.page));
  await t.see('a trending video', a.page.getByText(golden.title));
  t.eq('title', await a.page.title(), 'Stream2Gather');
  t.check('the box has focus on a desktop', await ui.linkBox(a.page).evaluate((el) => el === document.activeElement));
});

flow('landing: pasting a link opens a room playing it, and leaves the clipboard alone', async (t) => {
  const a = await t.person('a');
  const room = await startRoom(t, a, { url: golden.url });
  await t.see('the video title', ui.bar(a.page).getByRole('heading', { name: golden.title }));
  t.check('the clipboard is left alone', (await a.page.evaluate(() => navigator.clipboard.readText())) !== room.url);
  await t.until('it plays', async () => (await a.sample())?.state === 'playing');
});

flow('landing: every way of writing a YouTube link works', async (t) => {
  const a = await t.person('a');
  for (const link of [
    `https://youtu.be/${golden.id}`,
    `youtu.be/${golden.id}`,
    `www.youtube.com/watch?v=${golden.id}&t=30s`,
    `https://m.youtube.com/watch?v=${golden.id}`,
    `https://music.youtube.com/watch?v=${golden.id}&list=RD123`,
    `https://www.youtube.com/shorts/${golden.id}`,
    `  https://www.youtube.com/embed/${golden.id}  `,
  ]) {
    await a.page.goto(t.base);
    await ui.linkBox(a.page).fill(link);
    await ui.linkBox(a.page).press('Enter');
    const opened = await a.page.waitForURL(/\/r\//, { timeout: 5000 }).then(() => true, () => false);
    t.check(`opens ${link.trim()}`, opened);
  }
});

flow('landing: starting with nothing or with junk says what to do', async (t) => {
  const { page } = await t.person('a');
  await page.goto(t.base);
  await ui.startWatching(page).click();
  await t.see('the empty prompt', page.getByRole('status').getByText(/paste a youtube link first/i));
  t.eq('still on the landing page', new URL(page.url()).pathname, '/');

  await ui.linkBox(page).fill('cats playing piano');
  await t.gone('the prompt, on typing', page.getByText(/paste a youtube link first/i));
  await ui.startWatching(page).click();
  await t.see('the bad link note', page.getByRole('alert').getByText(/isn.t a youtube link/i));
  await t.see('the way out', ui.startEmpty(page));
});

flow('landing: a link the server refuses keeps the visitor here with a reason', async (t) => {
  const { page } = await t.person('a');
  for (const [link, reason] of [
    ['https://vimeo.com/76979871', /isn.t a youtube link/i],
    ['https://www.youtube.com/watch?v=doesnotexis', /cannot be played|can.t be played/i],
    [video('Not allowed in embeds').url, /cannot be played|can.t be played/i],
    [video('Private upload').url, /cannot be played|can.t be played/i],
    [video('Cozy Lofi').url, /live/i],
  ]) {
    await page.goto(t.base);
    await ui.linkBox(page).fill(link);
    await ui.startWatching(page).click();
    await t.expect(`a reason for ${link}`, page.getByRole('alert').getByText(reason));
    t.eq(`no room for ${link}`, new URL(page.url()).pathname, '/');
  }
});

flow('landing: an empty room opens on the stage, ready to pick a video', async (t) => {
  const a = await t.person('a');
  await startRoom(t, a);
  await t.see('the prompt', ui.stageHeading(a.page));
  await t.see('the box', ui.addBox(a.page));
  await t.see('popular picks', a.page.getByRole('region', { name: 'Popular on YouTube' }).getByRole('button').first());
  await t.see('the invite card', ui.chatLog(a.page).getByRole('button', { name: /invite/i }));
});

flow('landing: a trending pick starts a room with it', async (t) => {
  const a = await t.person('a');
  await a.page.goto(t.base);
  await setName(a, 'a');
  await a.page.getByRole('list').getByText(golden.title).first().click();
  await a.page.waitForURL(/\/r\//, { timeout: 8000 });
  await t.see('the title', ui.bar(a.page).getByRole('heading', { name: golden.title }));
});

flow('landing: every link on the page goes somewhere', async (t) => {
  const { page } = await t.person('a');
  await page.goto(t.base);
  await t.see('the page', ui.linkBox(page));
  const links = await page.getByRole('link').evaluateAll((all) => all.map((link) => link.getAttribute('href')));
  for (const href of new Set(links)) {
    if (href.startsWith('#')) t.check(`${href} has a target`, await page.locator(href).count() === 1);
    else if (href.startsWith('/')) t.check(`${href} answers`, (await fetch(`${t.base}${href}`)).ok);
  }
});

flow('landing: back leaves the room and forward returns', async (t) => {
  const a = await t.person('a');
  const room = await startRoom(t, a, { url: golden.url });
  await a.page.goBack();
  await t.see('the landing page again', ui.linkBox(a.page));
  await a.page.goForward();
  await t.see('a way back in', ui.join(a.page).or(ui.rail(a.page)));
  t.eq('the room address', a.page.url(), room.url);
});

flow('landing: too many new rooms says so, and offers nothing that would fail', async (t) => {
  const a = await t.person('a');
  await t.stack.redis('SET', `limit:rooms:${a.address}`, '120', 'EX', '600');
  await a.page.goto(t.base);
  await ui.startEmpty(a.page).click();
  await t.see('the limit', a.page.getByRole('alert').getByText(/too many new rooms/i));
  t.check('no empty room offer left', !(await ui.startEmpty(a.page).isVisible()));
  t.eq('still here', new URL(a.page.url()).pathname, '/');
});

flow('landing: a server that is down gets a calm note, and the page recovers', { serial: true }, async (t) => {
  const a = await t.person('a');
  const { page } = a;
  a.expectedErrors = /dynamically imported module/; // The room page warms up in the background, and can meet the outage.
  await page.goto(t.base);
  await ui.linkBox(page).fill(golden.url);
  await t.stack.stop();
  try {
    await ui.startWatching(page).click();
    await t.see('the note', page.getByRole('alert').getByText(/could not reach the server/i));
  } finally {
    await t.stack.start();
  }
  await ui.startWatching(page).click();
  await page.waitForURL(/\/r\//, { timeout: 8000 });
  t.check('the same box worked once it was back', true);
});

flow('landing: joining by the link a friend sent works from a cold start', async (t) => {
  const a = await t.person('a');
  const b = await t.person('b');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.see('b sees what a is playing', ui.bar(b.page).getByRole('heading', { name: golden.title }));
});
