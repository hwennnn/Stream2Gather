// Spends real quota and needs YouTube's network, so it only runs when asked:
//   YOUTUBE_API_KEY=... node flows.mjs --real --grep '^real'
import { joinRoom, openTab, player, search, startRoom, ui } from '../lib/app.mjs';
import { playerCover } from '../lib/layout.mjs';
import { flow } from '../lib/runner.mjs';

export const addRealFlows = () => {
  flow('real youtube: one search, the official player, two viewers', { timeout: 60_000 }, async (t) => {
    const a = await t.person('Ana', { realYouTube: true });
    const b = await t.person('Ben', { realYouTube: true });
    const room = await startRoom(t, a);
    await joinRoom(b, room.url);
    await search(a.page, 'big buck bunny');
    const first = ui.results(a.page).getByRole('listitem').first();
    await t.see('a real result', first, 12_000);
    await first.hover();
    await first.getByRole('button', { name: /^Queue/ }).first().click();
    await t.see('the official player', a.page.locator('iframe[src*="youtube"]'), 15_000);
    await t.until('both play', async () =>
      (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing' && s.time > 1), 30_000);
    const cover = await playerCover(a.page);
    t.check('nothing covers the real player', cover?.hits.length === 0, JSON.stringify(cover));
    await openTab(a.page, 'Chat');
    t.check('the fixture API was not used', t.fixtures.calls.search === 0);
    void player;
  });
};
