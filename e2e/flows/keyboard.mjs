// The room without a mouse, and the small things hands notice.
import { joinRoom, openTab, sample, search, sendChat, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');

const selected = (page) => page.getByRole('tab', { selected: true }).innerText();

flow('keyboard: the tabs move with arrows, Home and End', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await ui.tab(a.page, 'Chat').focus();
  await a.page.keyboard.press('ArrowRight');
  t.check('right goes to Queue', /Queue/.test(await selected(a.page)));
  await a.page.keyboard.press('End');
  t.check('End goes to People', /People/.test(await selected(a.page)));
  await a.page.keyboard.press('ArrowRight');
  t.check('and wraps round', /Chat/.test(await selected(a.page)));
  await a.page.keyboard.press('ArrowLeft');
  t.check('left wraps back', /People/.test(await selected(a.page)));
  await a.page.keyboard.press('Home');
  t.check('Home comes home', /Chat/.test(await selected(a.page)));
  t.eq('focus went with it', await a.page.evaluate(() => document.activeElement?.getAttribute('role')), 'tab');
});

flow('keyboard: the box keeps focus after sending, ready for the next line', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await sendChat(a.page, 'one');
  t.check('still in the box', await ui.chatBox(a.page).evaluate((box) => box === document.activeElement));
  await a.page.keyboard.type('two');
  await a.page.keyboard.press('Enter');
  await t.see('the second line', ui.chatLog(a.page).getByText('two', { exact: true }));
});

flow('keyboard: Cmd or Ctrl+K opens search from anywhere, Escape shuts it', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  await a.page.keyboard.press('Control+k');
  await t.until('the box has focus', () => ui.addBox(a.page).evaluate((box) => box === document.activeElement));
  await search(a.page, 'mix');
  await t.see('results', ui.results(a.page).getByRole('listitem'));
  await a.page.keyboard.press('Escape');
  await t.gone('the results', ui.results(a.page));
});

flow('keyboard: every control on the page can be reached with Tab and shows where it is', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: golden.url });
  const seen = new Map();
  for (let i = 0; i < 40; i += 1) {
    await a.page.keyboard.press('Tab');
    const stop = await a.page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName,
        ring: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
        onScreen: box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
      };
    });
    if (stop) seen.set(stop.name, stop);
  }
  t.check('Tab gets somewhere', seen.size >= 8, [...seen.keys()].join(', '));
  for (const [name, stop] of seen) {
    t.check(`${name} shows focus`, stop.ring);
    t.check(`${name} is on screen`, stop.onScreen);
  }
});

flow('hidden tab: the title counts what you missed, and clears when you look', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await openTab(a.page, 'People');
  await sendChat(b.page, 'are you there');
  await t.until('the count is in the title', async () => /^\(1\)/.test(await a.page.title()));
  await t.expect('and on the tab', ui.tab(a.page, 'Chat').getByText('1'));
  await openTab(a.page, 'Chat');
  await t.until('it clears', async () => !/^\(/.test(await a.page.title()));
});

flow('toasts: a burst of copying does not pile up over the room', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a, { url: sample(t.base) });
  for (let i = 0; i < 6; i += 1) await ui.invite(a.page).click();
  await t.sleep(200);
  t.check('a few at most', (await a.page.getByText(/link copied/i).count()) <= 2, String(await a.page.getByText(/link copied/i).count()));
});
