import { addByMessage, joinRoom, openTab, search, sendChat, startRoom, ui } from '../lib/app.mjs';
import { crowd } from '../lib/bots.mjs';
import { LANDSCAPE, PHONE } from '../lib/client.mjs';
import { video } from '../lib/fixtures.mjs';
import { insets } from '../lib/layout.mjs';
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
  await a.page.getByRole('button', { name: 'Send a reaction' }).filter({ visible: true }).tap();
  await a.page.getByRole('button', { name: 'React 👏' }).filter({ visible: true }).tap();
  await t.see('Ben sees it', ui.seats(b.page).getByText('👏'));
  await noSideScroll(t, a.page, 'the chat');
});

flow('phone: the room has its name, a labelled Leave, seats you can hit, and reactions in the message row', async (t) => {
  const a = await t.person('Ana', { viewport: { width: 390, height: 844 }, phone: true });
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url, name: 'Ana' });
  await joinRoom(b, room.url);
  await t.see('the room name', a.page.getByRole('heading', { level: 1 }).filter({ visible: true }));
  await t.see('Leave says Leave', a.page.getByRole('link', { name: 'Leave room' }).filter({ hasText: 'Leave', visible: true }));
  const seats = a.page.getByRole('list', { name: 'In the room' }).filter({ visible: true });
  const widths = await seats.locator('.seat-disc').evaluateAll((discs) => discs.map((disc) => disc.offsetWidth));
  t.check('every seat is at least 40px', widths.length > 0 && widths.every((width) => width >= 40), widths.join());
  const row = a.page.getByRole('button', { name: /^React / }).filter({ visible: true });
  t.eq('no row of reactions takes up the room', await row.count(), 0);
  await a.page.getByRole('button', { name: 'Send a reaction' }).filter({ visible: true }).tap();
  t.eq('all six behind the button', await row.count(), 6);
  const rest = await a.page.getByRole('button', { name: 'React 🔥' }).filter({ visible: true }).evaluate((button) => getComputedStyle(button).filter);
  t.eq('in full colour at rest', rest, 'none');
  await noSideScroll(t, a.page, 'the room');
});

flow('phone: the light stays in the top bar, and a full row still only slides sideways', async (t) => {
  const a = await phone(t, 'Ana');
  const room = await startRoom(t, a, { url: golden.url, name: 'Ana' });
  const bots = await crowd(t, room.slug, 9);
  const read = () => a.page.evaluate(() => {
    const row = [...document.querySelectorAll('.room-header .seats')].find((node) => node.getClientRects().length);
    const seat = row.querySelector('.seat[data-away]');
    const pool = getComputedStyle(seat, '::before');
    const top = seat.getBoundingClientRect().top + parseFloat(pool.top);
    const clock = [...document.querySelectorAll('.seat-track-slot *')].filter((node) => /^\d+:\d\d$/.test(node.textContent) && node.getClientRects().length).at(-1);
    const box = clock?.getBoundingClientRect();
    return {
      full: row.scrollWidth > row.clientWidth,
      lit: pool.backgroundImage.startsWith('radial-gradient'),
      // A row that holds its light clips it, so that's where the light can end. One that doesn't has only the pool's own box.
      end: getComputedStyle(row).overflowY === 'visible' ? top + parseFloat(pool.height) : row.getBoundingClientRect().bottom,
      sliding: getComputedStyle(row).overflowY,
      header: document.querySelector('.room-header').getBoundingClientRect().bottom,
      player: document.querySelector('[data-player]').getBoundingClientRect().top,
      clockOnTop: box ? clock.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) : null,
    };
  });
  await t.until('a full row', async () => (await read()).full, 8000);
  const upright = await read();
  t.check('everyone casts a little light', upright.lit);
  t.check('it ends in the bar, above the player', upright.end <= upright.header && upright.header <= upright.player, JSON.stringify(upright));
  t.eq('the row can’t scroll up and down', upright.sliding, 'hidden');
  t.check('the clock is on top of it', upright.clockOnTop === true);
  for (const [name, viewport] of [['a short phone', { width: 320, height: 568 }], ['sideways', LANDSCAPE]]) {
    await a.page.setViewportSize(viewport);
    await t.sleep(200);
    const now = await read();
    t.check(`${name}: still in the bar, above the player`, now.end <= now.header + 2 && now.end <= now.player, JSON.stringify(now));
  }
  bots.forEach((bot) => bot.close());
});

for (const [width, height] of [[390, 844], [390, 664], [320, 568]]) {
  flow(`phone ${width}x${height}: the status has the line, and Skip waits in Queue`, async (t) => {
    const a = await t.person('Ana', { viewport: { width, height }, phone: true });
    const b = await t.person('Ben');
    const room = await startRoom(t, a, { url: golden.url, name: 'Ana' });
    await addByMessage(t, a.page, [train.url]);
    await joinRoom(b, room.url);
    const status = ui.bar(a.page).locator('[data-room-status] span').first();
    await t.see('the sentence', ui.bar(a.page).getByText(/everyone together/));
    t.check('whole, not cut off', await status.evaluate((el) => el.scrollWidth <= el.clientWidth));
    t.eq('no Skip under the player', await ui.bar(a.page).getByRole('button', { name: 'Skip' }).count(), 0);
    await openTab(a.page, 'Queue');
    await ui.rail(a.page).getByRole('button', { name: 'Skip' }).tap();
    await t.see('Skip still moves the room', ui.bar(b.page).getByRole('heading', { name: train.title }));
    await noSideScroll(t, a.page, 'the room');
  });
}

flow('phone: someone who can’t control the room sees who can, and no Skip anywhere', async (t) => {
  const host = await t.person('Hana');
  const guest = await phone(t, 'Gus');
  const room = await startRoom(t, host, { url: golden.url, name: 'Hana' });
  await addByMessage(t, host.page, [train.url]);
  await joinRoom(guest, room.url);
  await openTab(host.page, 'People');
  await ui.hostSwitch(host.page).click();
  await t.see('the chip', ui.bar(guest.page).getByText('Hana’s driving', { exact: true }));
  await openTab(guest.page, 'Queue');
  await t.see('the queue says so', ui.rail(guest.page).getByText('Only the host can change the queue.'));
  t.eq('no Skip', await guest.page.getByRole('button', { name: 'Skip' }).count(), 0);
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

flow('phone: the track sits under the seats, in a row kept for it, and a short phone gives it to chat', async (t) => {
  const a = await phone(t, 'Ana');
  const b = await phone(t, 'Ben');
  const room = await startRoom(t, a);
  const slot = a.page.locator('.seat-track-slot');
  const box = (selector) => a.page.locator(selector).first().evaluate((node) => {
    const { top, bottom, left, right } = node.getBoundingClientRect();
    return JSON.stringify({ top, bottom, left, right });
  });
  const empty = await box('.seat-track-slot');
  const header = await box('.room-header');
  await addByMessage(t, a.page, [golden.url]);
  await joinRoom(b, room.url);
  await t.see('the room’s tick', slot.locator('.seat-track-room'));
  await t.see('the room clock', slot.getByText(/^\d+:\d\d$/));
  t.eq('the row was already there', await box('.seat-track-slot'), empty);
  t.eq('the header did not grow', await box('.room-header'), header);
  const above = await a.page.evaluate(() => document.querySelector('.seat-track-slot').getBoundingClientRect().bottom <= document.querySelector('[data-player]').getBoundingClientRect().top);
  t.check('the track is off the player', above);
  for (const viewport of [PHONE, { width: 360, height: 740 }]) {
    await a.page.setViewportSize(viewport);
    const room = await insets(a.page, a.page.getByRole('banner'));
    t.check(`${viewport.width}: the clock clears the bottom of the bar`, room?.bottom >= 4, JSON.stringify(room));
  }
  await a.page.setViewportSize({ width: 320, height: 568 });
  await t.until('a short phone keeps the height for chat', async () => !(await slot.isVisible()));
});

flow('phone: a small phone keeps real room for messages, even with a notice up, and the player its minimum', async (t) => {
  const a = await phone(t, 'Ana', { width: 320, height: 568 });
  const b = await t.person('Ben');
  const room = await startRoom(t, a);
  await addByMessage(t, a.page, [golden.url]);
  await joinRoom(b, room.url);
  for (const line of ['오늘 영상 진짜 재밌다 다음에는 뭐 볼까요?', 'a much longer line that has to wrap at least once in a rail this narrow', video('바이, 썸머').url]) await sendChat(b.page, line);
  const log = ui.chatLog(a.page);
  const textRoom = () => log.evaluate((el) => {
    const { paddingTop, paddingBottom } = getComputedStyle(el);
    return Math.round(el.clientHeight - parseFloat(paddingTop) - parseFloat(paddingBottom));
  });
  await t.see('the link', log.getByRole('button', { name: 'Add to queue' }));
  t.check('five lines of text with nothing else up', (await textRoom()) >= 100, `${await textRoom()}px`);
  await log.getByRole('button', { name: 'Add to queue' }).last().tap();
  await t.see('a notice', ui.rail(a.page).locator('[aria-live] p'));
  t.check('three lines of text with a notice up', (await textRoom()) >= 60, `${await textRoom()}px`);
  const player = await a.page.locator('[data-player]').evaluate((el) => el.getBoundingClientRect().height);
  t.check('the player keeps its 200px', player >= 200, `${player}px`);
  await noSideScroll(t, a.page, 'the small phone');
  await a.page.getByRole('button', { name: 'Send a reaction' }).filter({ visible: true }).tap();
  await a.page.getByRole('button', { name: 'React 👏' }).filter({ visible: true }).tap();
  await t.see('reactions still work, from beside the box', ui.seats(b.page).getByText('👏'));
});
