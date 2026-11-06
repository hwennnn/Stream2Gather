// Sizes people actually have, beyond the four the rail is measured at.
import { joinRoom, openTab, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { blockedControls, playerCover, sideScroll, spills } from '../lib/layout.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');

const SIZES = [
  { name: 'small phone', width: 320, height: 568, phone: true },
  { name: 'phone', width: 360, height: 740, phone: true },
  { name: 'phone on its side', width: 844, height: 390, phone: true },
  { name: 'tablet', width: 768, height: 1024, phone: true },
  { name: 'short laptop', width: 1280, height: 600 },
  { name: 'old laptop', width: 1366, height: 768 },
  { name: 'wide and short', width: 2560, height: 700 },
];

const onScreen = (t, label, locator, height) => locator.first().boundingBox().then((box) => {
  t.check(`${label} is on screen`, box && box.y >= 0 && box.y + box.height <= height + 1, JSON.stringify(box));
});

for (const { name, width, height, phone } of SIZES) {
  flow(`window ${name} (${width}x${height}): the room fits and everything can be reached`, async (t) => {
    const host = await t.person('host');
    const room = await startRoom(t, host, { url: golden.url });
    const viewer = await t.person('Ben', { viewport: { width, height }, phone });
    await joinRoom(viewer, room.url);
    const { page } = viewer;
    await t.until('it plays', async () => (await viewer.sample())?.state === 'playing');

    t.eq('no sideways scroll', await sideScroll(page), 0);
    const cover = await playerCover(page);
    t.check('nothing covers the player', cover?.hits.length === 0, JSON.stringify(cover?.hits));
    t.check('the player is at least 200 by 200', cover?.width >= 200 && cover?.height >= 200, `${cover?.width} by ${cover?.height}`);
    const blocked = await blockedControls(page);
    t.check('every control can be reached', blocked.length === 0, blocked.slice(0, 4).join('; '));
    if (await ui.bar(page).isVisible()) {
      const bar = await spills(page, ui.bar(page));
      t.check('the bar holds together', bar.length === 0, JSON.stringify(bar.slice(0, 3)));
    }

    if (await ui.rail(page).isVisible()) {
      await onScreen(t, 'the chat box', ui.chatBox(page), height);
      await openTab(page, 'Queue');
      await onScreen(t, 'the add box', ui.addBox(page), height);
    }
  });
}

flow('window: shrinking and growing keeps what was typed and what was playing', async (t) => {
  const a = await t.person('Ana', { viewport: { width: 1440, height: 900 } });
  await startRoom(t, a, { url: golden.url });
  await ui.chatBox(a.page).fill('half a thought');
  await t.until('playing', async () => (await a.sample())?.state === 'playing');
  const before = (await a.sample()).time;
  await a.page.setViewportSize({ width: 390, height: 844 });
  await t.sleep(600);
  await a.page.setViewportSize({ width: 1440, height: 900 });
  await t.see('the rail', ui.rail(a.page));
  t.eq('the draft', await ui.chatBox(a.page).inputValue(), 'half a thought');
  t.check('the video did not restart', (await a.sample())?.time >= before, String((await a.sample())?.time));
  t.eq('it plays on', (await a.sample())?.state, 'playing');
  await t.expect('same video', ui.bar(a.page).getByRole('heading', { name: golden.title }));
});

flow('window phone: what a thumb has to hit is big enough', async (t) => {
  const a = await t.person('host');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben', { viewport: { width: 390, height: 844 }, phone: true });
  await joinRoom(b, room.url);
  for (const tab of ['Chat', 'Queue', 'People']) {
    await openTab(b.page, tab);
    const small = await b.page.evaluate(() => [...document.querySelectorAll('button, a[href], input, [role=tab], [role=switch]')]
      .filter((el) => el.checkVisibility({ opacityProperty: true }) && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0)
      .map((el) => ({ box: el.getBoundingClientRect(), name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName }))
      .filter(({ box }) => box.height < 44 || box.width < 44)
      .map(({ box, name }) => `${name.slice(0, 20)} ${Math.round(box.width)}x${Math.round(box.height)}`));
    t.check(`${tab}: nothing under 44px`, small.length === 0, small.join(', '));
  }
});
