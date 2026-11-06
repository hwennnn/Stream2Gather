// Four things a desktop dogfood found, each measured in the DOM at the window it was seen in.
import { joinRoom, openTab, player, react, sample, startRoom, ui } from '../lib/app.mjs';
import { crowd } from '../lib/bots.mjs';
import { video } from '../lib/fixtures.mjs';
import { playerCover } from '../lib/layout.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const LAPTOP = { width: 1440, height: 779 };
const LAPTOP_SHORT = { width: 1440, height: 723 };

const box = (locator) => locator.first().evaluate((node) => {
  const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
  return { left, right, top, bottom, width, height };
});

const seatRow = (page) => page.getByRole('list', { name: 'In the room' }).filter({ visible: true }).first();

const watching = async (t, url, viewport = LAPTOP) => {
  const a = await t.person('Ana', { viewport });
  const b = await t.person('Ben', { viewport });
  const room = await startRoom(t, a, { url });
  await joinRoom(b, room.url);
  await t.until('both play', async () =>
    (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing' && s.time > 0.5), 12_000);
  await t.sleep(3000); // A joiner's first seconds have a flow of their own.
  return { a, b };
};

for (const viewport of [LAPTOP, LAPTOP_SHORT]) {
  flow(`dogfood: an empty room's seats sit under the screen and inside its edges at ${viewport.height}`, async (t) => {
    const a = await t.person('Ana', { viewport });
    await startRoom(t, a);
    await t.see('the screen', ui.stageHeading(a.page));
    const screen = await box(a.page.locator('.stage'));
    const seats = await box(seatRow(a.page));
    t.check('seats start below the screen', seats.top >= screen.bottom, `seats at ${seats.top}, screen ends at ${screen.bottom}`);
    t.check('the first seat is inside the screen\'s left edge', seats.left >= screen.left, `seat at ${seats.left}, screen at ${screen.left}`);
    t.check('and the last inside its right edge', seats.right <= screen.right, `seat ends ${seats.right}, screen ends ${screen.right}`);
    const shown = await box(seatRow(a.page).getByRole('listitem').last());
    t.check('all of it inside the window', shown.bottom <= viewport.height, `${shown.bottom} of ${viewport.height}`);
  });
}

flow('dogfood: a full empty room in a short window keeps every seat apart, under the screen', async (t) => {
  const a = await t.person('Ana', { viewport: { width: 1440, height: 600 } });
  const room = await startRoom(t, a);
  const bots = await crowd(t, room.slug, 9);
  const faces = seatRow(a.page).locator('.seat-disc, .seat-empty, .seat-more');
  await t.until('the row fills', async () => (await faces.count()) >= 9, 8000);
  const screen = await box(a.page.locator('.stage'));
  const spans = await faces.evaluateAll((list) => list.map((face) => {
    const { left, right, width, height } = face.getBoundingClientRect();
    return { left, right, width, height };
  }));
  const stacked = spans.filter((span, index) => index > 0 && span.left < spans[index - 1].right - 0.5);
  t.eq('no seat sits on the next', stacked.length, 0);
  t.check('they stay round', spans.every(({ width, height }) => Math.abs(width - height) <= 1), JSON.stringify(spans[0]));
  t.check('and inside the screen', spans.at(-1).right <= screen.right, `${spans.at(-1).right} of ${screen.right}`);
  bots.forEach((one) => one.close());
});

/** What is painted at a point, through anything see-through. */
const paintAt = (page, x, y) => page.evaluate(([px, py]) => {
  for (let node = document.elementFromPoint(px, py); node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return colour;
  }
  return null;
}, [x, y]);

const stagePaint = (page) => page.evaluate(() => {
  const probe = document.body.appendChild(document.createElement('i'));
  probe.style.background = 'var(--color-stage)';
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
});

flow('dogfood: theatre takes the height, on black, with reactions still rising', async (t) => {
  const { a, b } = await watching(t, golden.url);
  const before = await box(a.page.locator('[data-player]'));
  await a.page.getByRole('button', { name: 'Theatre' }).click();
  await t.gone('the rail', ui.rail(a.page));
  const after = await box(a.page.locator('[data-player]'));
  t.check('the video is much taller', after.height >= before.height + 60, `${before.width}x${before.height} to ${after.width}x${after.height}`);
  t.check('it stays 16:9', Math.abs(after.width / after.height - 16 / 9) < 0.02, `${after.width}x${after.height}`);
  const controls = await box(ui.bar(a.page));
  t.check('the bar is still on screen', controls.bottom <= LAPTOP.height + 0.5, `${controls.bottom}`);
  t.check('the bar is under the video', controls.top >= after.bottom, `${controls.top} under ${after.bottom}`);
  const middle = (after.top + after.bottom) / 2;
  const black = await stagePaint(a.page);
  t.eq('left of the video is the stage colour', await paintAt(a.page, after.left / 2, middle), black);
  t.eq('so is the right', await paintAt(a.page, (after.right + LAPTOP.width) / 2, middle), black);
  await react(b.page, '🔥');
  const rising = a.page.locator('.reaction').filter({ visible: true });
  await t.see('a reaction rising', rising);
  let [crossed, seen] = [0, 0];
  const deadline = Date.now() + 2800;
  while (Date.now() < deadline) {
    const boxes = await rising.evaluateAll((nodes) => nodes.flatMap((node) => [node, ...node.children]).map((node) => {
      const { left, right, top, bottom } = node.getBoundingClientRect();
      return { left, right, top, bottom };
    }));
    seen += boxes.length > 0 ? 1 : 0;
    // The lane clips what it holds, so only what's left of the clip can reach the video.
    const lane = await a.page.locator('.reaction-lane').filter({ visible: true }).first().evaluate((node) => node.getBoundingClientRect().left).catch(() => Infinity);
    crossed += boxes.filter((one) => Math.max(one.left, lane) < after.right && one.right > after.left && one.top < after.bottom && one.bottom > after.top).length;
    await t.sleep(100);
  }
  t.check('it stayed on screen for its rise', seen >= 10, `seen in ${seen} samples`);
  t.eq('it never touched the video', crossed, 0);
  const cover = await playerCover(a.page);
  t.check('nothing covers the player', cover?.hits.length === 0, JSON.stringify(cover));
});

/** Everything that would call someone behind, on one screen. */
const behind = async (page) => {
  const rings = await page.locator('[data-trouble=true]').count();
  const line = await page.locator('[data-room-status]').filter({ visible: true }).first().innerText().catch(() => '');
  const people = await page.getByRole('tabpanel', { name: 'People' }).getByText('Catching up').count();
  const words = /catching up/i.test(line) ? 1 : 0;
  return rings + people + words;
};

for (const [label, source] of [['YouTube', () => golden.url], ['a file', (t) => sample(t.base)]]) {
  flow(`dogfood (${label}): nobody reads as catching up in a paused room, or for long after`, async (t) => {
    const { a, b } = await watching(t, source(t));
    await openTab(a.page, 'People');
    await openTab(b.page, 'People');
    await player(b.page).pause();
    await t.see('the pause', ui.bar(a.page).getByText(/Paused by Ben/));
    await t.see('the pause, for Ben', ui.bar(b.page).getByText(/Paused by you/));
    let worst = 0;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      worst = Math.max(worst, await behind(a.page), await behind(b.page));
      await t.sleep(150);
    }
    t.eq('nobody is behind a room that is not moving', worst, 0);
    await ui.bar(a.page).getByRole('button', { name: /resume for everyone/i }).click();
    await t.until('both play again', async () => (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing'), 8000);
    await t.until('and nobody is behind within 4s', async () => (await behind(a.page)) + (await behind(b.page)) === 0, 4000);
  });
}

flow('dogfood: the landing picture centres each face and name in its seat', async (t) => {
  const a = await t.person('Ana', { viewport: LAPTOP });
  await a.page.goto(t.base);
  const seats = a.page.locator('.picture-row .seat');
  await t.until('the picture has its seats', async () => (await seats.count()) >= 2);
  const offsets = await seats.evaluateAll((list) => list.flatMap((seat) => {
    const middle = (node) => {
      const { left, right } = node.getBoundingClientRect();
      return (left + right) / 2;
    };
    return [...seat.children].filter((part) => part.getBoundingClientRect().width > 0 && !part.matches('.picture-say')).map((part) => Math.abs(middle(part) - middle(seat)));
  }));
  t.check('every part is centred', offsets.length > 2 && Math.max(...offsets) <= 1, JSON.stringify(offsets));
});
