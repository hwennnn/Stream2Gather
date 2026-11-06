// How a person uses the app, in the words they see. The redesign may move and
// restyle anything, so nothing here knows a class name, and every label a flow
// depends on is in this file.
export const ui = {
  linkBox: (page) => page.getByRole('textbox', { name: /youtube link|paste/i }).first(),
  startWatching: (page) => page.getByRole('button', { name: /^start (watching|room)$/i }),
  startEmpty: (page) => page.getByRole('button', { name: /empty room/i }),
  joinName: (page) => page.getByRole('textbox', { name: /joining as|your name/i }),
  join: (page) => page.getByRole('button', { name: 'Take your seat', exact: true }),
  rail: (page) => page.getByRole('complementary', { name: 'Room' }),
  tab: (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) }),
  invite: (page) => page.getByRole('button', { name: 'Invite', exact: true }).filter({ visible: true }).first(),
  chatBox: (page) => page.getByRole('textbox', { name: 'Message' }),
  chatLog: (page) => page.getByRole('log', { name: 'Chat messages' }),
  addBox: (page) => page.getByRole('textbox', { name: 'Add a video' }).first(),
  results: (page) => page.getByRole('region', { name: 'Search results' }),
  upNext: (page) => page.getByRole('region', { name: 'Up next', exact: true }),
  bar: (page) => page.getByRole('region', { name: 'Player controls' }),
  hostSwitch: (page) => page.getByRole('switch'),
  skip: (page) => page.getByRole('button', { name: /^(skip|finish video)$/i }).first(),
  stageHeading: (page) => page.getByRole('heading', { name: /what are we watching|queue.s finished/i }),
  pill: (page, text) => page.getByRole('region', { name: 'Player controls' }).getByText(text),
};

/** The row of emoji is in the room at some sizes, and behind a button at others. */
export const react = async (page, emoji) => {
  const shown = page.getByRole('button', { name: `React ${emoji}` }).filter({ visible: true });
  const behindButton = await shown.count() === 0;
  if (behindButton) await page.getByRole('button', { name: 'Send a reaction' }).filter({ visible: true }).click();
  await shown.first().click();
  if (behindButton) await page.keyboard.press('Escape');
};

export const setName = (client, name, page = client.page) =>
  page.evaluate((next) => fetch('/v1/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: next }),
  }), name);

const inRoom = (page) => page.waitForURL(/\/r\//, { timeout: 10_000 });

export const slugOf = (page) => new URL(page.url()).pathname.split('/')[2];

/** Lands in a new room as its host, by the landing page. */
export const startRoom = async (t, client, { url, name = client.name } = {}) => {
  const { page } = client;
  await page.goto(t.base);
  await setName(client, name);
  if (url) {
    await ui.linkBox(page).fill(url);
    await ui.startWatching(page).click();
  } else {
    await ui.startEmpty(page).click();
  }
  await inRoom(page);
  await ui.rail(page).waitFor({ state: 'visible', timeout: 10_000 });
  return { url: page.url(), slug: slugOf(page) };
};

export const joinRoom = async (client, roomUrl, { name = client.name, page = client.page } = {}) => {
  await page.goto(roomUrl);
  await ui.joinName(page).fill(name);
  await ui.join(page).click();
  await ui.rail(page).waitFor({ state: 'visible', timeout: 10_000 });
};

/** After a reload: the gate if it asks, and then the room. */
export const reenter = async (page) => {
  await ui.join(page).or(ui.rail(page)).first().waitFor({ state: 'visible', timeout: 10_000 });
  if (await ui.join(page).isVisible()) await ui.join(page).click();
  await ui.rail(page).waitFor({ state: 'visible', timeout: 10_000 });
};

export const openTab = (page, name) => ui.tab(page, name).click();

/** Searches from whichever box is showing, on the stage or in the queue tab. */
export const search = async (page, text) => {
  await ui.addBox(page).fill(text);
  await ui.addBox(page).press('Enter');
};

export const sendChat = async (page, text) => {
  await ui.chatBox(page).fill(text);
  await ui.chatBox(page).press('Enter');
};

/** Fast setup through the app's own socket, within its rate limit. */
export const addByMessage = async (t, page, urls, mode = 'end') => {
  for (const url of urls) {
    await page.evaluate(([link, how]) => window.__net.send('queue.add', { url: link, mode: how }), [url, mode]);
    await t.sleep(250);
  }
};

/** Changes the room's live state directly, as fast setup. Viewers need a reconnect to see it. */
export const seedRoom = async (t, slug, change) => {
  const id = await t.stack.sql(`SELECT id FROM rooms WHERE slug = '${slug}'`);
  const key = `room:${id}:state`;
  const state = JSON.parse(await t.stack.redis('HGET', key, 'doc'));
  change(state);
  state.version += 1;
  await t.stack.redis('HSET', key, 'doc', JSON.stringify(state), 'version', String(state.version));
};

/** The room as the server holds it. */
export const roomDoc = async (t, slug) => {
  const id = await t.stack.sql(`SELECT id FROM rooms WHERE slug = '${slug}'`);
  return JSON.parse(await t.stack.redis('HGET', `room:${id}:state`, 'doc'));
};

/** The player, played the way a viewer plays it. A file is a real video. */
export const player = (page) => ({
  pause: () => page.evaluate(() => (window.__yt ? window.__yt.pauseVideo() : document.querySelector('video').pause())),
  play: () => page.evaluate(() => (window.__yt ? window.__yt.playVideo() : document.querySelector('video').play())),
  seek: (to) => page.evaluate((seconds) => {
    if (window.__yt) window.__yt.seekTo(seconds);
    else document.querySelector('video').currentTime = seconds;
  }, to),
});

export const sample = (base, name = 'sample.mp4', tag = '') => `${base}/${name}${tag ? `?v=${tag}` : ''}`;
