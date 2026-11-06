import { addByMessage, joinRoom, openTab, search, sendChat, startRoom, ui } from '../lib/app.mjs';
import { LANDSCAPE, PHONE } from '../lib/client.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');
const rain = video('Rainy Window');

const phone = (t, name, viewport = PHONE) => t.person(name, { viewport, phone: true });

const noSideScroll = async (t, page, where) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t.check(`${where} has no sideways scroll`, over <= 0, `${over}px over`);
};

flow('phone: the whole first visit works with a thumb', async (t) => {
  const a = await phone(t, 'Ana');
  await a.page.goto(t.base);
  await noSideScroll(t, a.page, 'the landing page');
  await t.see('the box', ui.linkBox(a.page));
  t.check('no keyboard pops up unasked', !(await ui.linkBox(a.page).evaluate((el) => el === document.activeElement)));
  await ui.linkBox(a.page).fill(golden.url);
  await ui.startWatching(a.page).tap();
  await a.page.waitForURL(/\/r\//, { timeout: 8000 });
  await t.see('the room', ui.rail(a.page));
  await t.see('the title', ui.bar(a.page).getByRole('heading', { name: golden.title }));
  await noSideScroll(t, a.page, 'the room');
});

flow('phone: joining from a shared link', async (t) => {
  const host = await t.person('Ana');
  const b = await phone(t, 'Ben');
  const room = await startRoom(t, host, { url: golden.url });
  await b.page.goto(room.url);
  await noSideScroll(t, b.page, 'the gate');
  await t.see('Join on screen', ui.join(b.page));
  const box = await ui.join(b.page).boundingBox();
  t.check('without scrolling', box.y + box.height <= PHONE.height, JSON.stringify(box));
  await ui.join(b.page).tap();
  await t.see('the video', ui.bar(b.page).getByRole('heading', { name: golden.title }));
});

flow('phone: Invite hands over to the share sheet', async (t) => {
  const a = await phone(t, 'Ana');
  const room = await startRoom(t, a);
  await a.page.evaluate(() => {
    window.__shared = [];
    navigator.share = async (data) => { window.__shared.push(data.url); };
  });
  await ui.invite(a.page).tap();
  await t.until('the sheet got the link', async () => (await a.page.evaluate(() => window.__shared[0])) === room.url);
});

flow('phone: a row tap queues a search result, ⋯ opens the rest', async (t) => {
  const a = await phone(t, 'Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await openTab(a.page, 'Queue');
  await search(a.page, 'mix');
  const result = ui.results(a.page).getByRole('listitem').filter({ hasText: train.title });
  // Anywhere on the row counts, and a thumb lands on the words as often as the picture.
  await result.getByText('Slow Travel Films').tap({ force: true });
  await t.see('it is added', result.getByText(/added/i));
  await a.page.getByRole('button', { name: `More for ${rain.title}` }).tap();
  const tray = ui.results(a.page).getByRole('listitem').filter({ hasText: rain.title });
  await tray.getByRole('button', { name: 'Play next', exact: true }).tap();
  await t.see('Ben sees it first', b.page.getByRole('region', { name: 'Up next in the queue' }).getByRole('button', { name: new RegExp(rain.title) }).first());
});

flow('phone: tapping anywhere on a queue row opens its tray', async (t) => {
  const a = await phone(t, 'Ana');
  await startRoom(t, a, { url: golden.url });
  await addByMessage(t, a.page, [train.url]);
  await openTab(a.page, 'Queue');
  const row = ui.upNext(a.page).getByRole('listitem').filter({ hasText: train.title });
  await row.getByText(/\d+:\d\d/).tap({ force: true });
  await t.see('the tray from the words', row.getByRole('button', { name: 'Remove', exact: true }));
});

flow('phone: queue rows open a tray with every action', async (t) => {
  const a = await phone(t, 'Ana');
  await startRoom(t, a, { url: golden.url });
  await addByMessage(t, a.page, [train.url, rain.url]);
  await openTab(a.page, 'Queue');
  const onTop = await a.page.locator('.row-grip').first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
  t.check('a thumb on the grip gets the grip, not the row', onTop);
  await openTab(a.page, 'Queue');
  const row = ui.upNext(a.page).getByRole('listitem').filter({ hasText: rain.title });
  await row.getByRole('button', { name: `More for ${rain.title}` }).tap();
  await t.see('the tray', row.getByRole('button', { name: 'Remove', exact: true }));
  await row.getByRole('button', { name: 'Play next', exact: true }).tap();
  await t.until('it moves up', async () =>
    (await ui.upNext(a.page).getByRole('listitem').first().innerText()).includes(rain.title));
  const moved = ui.upNext(a.page).getByRole('listitem').filter({ hasText: train.title });
  await moved.getByRole('button', { name: `More for ${train.title}` }).tap();
  await moved.getByRole('button', { name: 'Remove', exact: true }).tap();
  await t.gone('the removed row', moved);
});

flow('phone: chat works above the keyboard line, with reactions behind one button', async (t) => {
  const a = await phone(t, 'Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await sendChat(a.page, 'from a phone');
  await t.see('Ben gets it', ui.chatLog(b.page).getByText('from a phone'));
  await sendChat(b.page, 'to a phone');
  await t.see('Ana gets it', ui.chatLog(a.page).getByText('to a phone'));
  await a.page.getByRole('button', { name: 'React 👏' }).filter({ visible: true }).tap();
  await t.see('Ben sees it', ui.rail(b.page).getByText('👏'));
  await noSideScroll(t, a.page, 'the chat');
});

flow('phone: the room has its name, a labelled Leave, seats you can hit, and reactions on every tab', async (t) => {
  const a = await t.person('Ana', { viewport: { width: 390, height: 844 }, phone: true });
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url, name: 'Ana' });
  await joinRoom(b, room.url);
  await t.see('the room name', a.page.getByRole('heading', { level: 1 }).filter({ visible: true }));
  await t.see('Leave says Leave', a.page.getByRole('link', { name: 'Leave room' }).filter({ hasText: 'Leave', visible: true }));
  const seats = a.page.getByRole('list', { name: 'In the room' }).filter({ visible: true });
  const widths = await seats.locator('.seat-disc').evaluateAll((discs) => discs.map((disc) => disc.offsetWidth));
  t.check('every seat is at least 40px', widths.length > 0 && widths.every((width) => width >= 40), widths.join());
  for (const tab of ['Queue', 'People', 'Chat']) {
    await openTab(a.page, tab);
    const row = a.page.getByRole('button', { name: /^React / }).filter({ visible: true });
    t.eq(`all six reactions show on ${tab}`, await row.count(), 6);
  }
  const rest = await a.page.getByRole('button', { name: 'React 🔥' }).filter({ visible: true }).evaluate((button) => getComputedStyle(button).filter);
  t.eq('in full colour at rest', rest, 'none');
  await noSideScroll(t, a.page, 'the room');
});

flow('phone: turning sideways keeps the room, the draft and the controls', async (t) => {
  const a = await phone(t, 'Ana');
  await startRoom(t, a, { url: golden.url });
  await addByMessage(t, a.page, [train.url]);
  await ui.chatBox(a.page).fill('still typing');
  await a.page.setViewportSize(LANDSCAPE);
  await t.see('the player', a.page.locator('iframe').first());
  await t.see('the rail', ui.rail(a.page));
  await t.see('Skip reachable', a.page.getByRole('banner').getByRole('button', { name: 'Skip' }));
  await noSideScroll(t, a.page, 'sideways');
  t.eq('the draft survives', await ui.chatBox(a.page).inputValue(), 'still typing');
  await a.page.setViewportSize(PHONE);
  await t.see('back upright', ui.bar(a.page));
});

flow('phone: the host switch and rename work by touch', async (t) => {
  const a = await phone(t, 'Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await openTab(a.page, 'People');
  await ui.hostSwitch(a.page).tap();
  await t.see('the guest is locked', b.page.getByText('Ana’s driving', { exact: true }));
  await ui.rail(a.page).getByRole('button', { name: 'Rename' }).tap();
  await a.page.getByRole('textbox', { name: 'Your name' }).fill('Thumbs');
  await a.page.getByRole('button', { name: 'Save' }).tap();
  await t.see('saved', ui.rail(a.page).getByRole('listitem').filter({ hasText: 'Thumbs' }));
});
