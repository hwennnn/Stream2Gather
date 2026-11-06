// The seats, the way out and the way back.
import { addByMessage, joinRoom, openTab, player, react, reenter, sample, sendChat, startRoom, ui } from '../lib/app.mjs';
import { crowd } from '../lib/bots.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');

const seats = (page) => page.getByRole('list', { name: 'In the room' }).filter({ visible: true }).first();

flow('seats: everyone keeps their seat, and the status line says who came and went', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const c = await t.person('Cal');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.see('Ana hears Ben sit', ui.bar(a.page).getByText(/Ben took a seat/));
  await joinRoom(c, room.url);
  const order = () => seats(a.page).getByRole('listitem').allInnerTexts();
  const names = (rows) => rows.map((row) => row.split('\n').at(-1)).filter(Boolean);
  const initials = (rows) => rows.map((row) => row.split('\n')[0]);
  await t.until('Cal on the row', async () => initials(await order()).includes('C'));
  const before = names(await order());
  const seatOfCal = initials(await order()).indexOf('C');
  t.check('you are You', before.includes('You'), before.join(', '));
  await b.page.goto('about:blank');
  await t.see('Ana hears Ben go', ui.bar(a.page).getByText(/Ben stepped out/), 8000);
  await t.gone('Ben off the row, or dimmed', seats(a.page).locator('[data-away=false]').getByText('Ben'), 12_000);
  t.eq('Cal has not moved', initials(await order()).indexOf('C'), seatOfCal);
});

flow('seats: a full row says how many more, and that opens People', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const bots = await crowd(t, room.slug, 14);
  const more = a.page.getByRole('button', { name: /\d+ more people/ }).filter({ visible: true }).first();
  await t.see('how many more', more, 8000);
  await more.click();
  await t.see('the whole list', ui.rail(a.page).getByRole('listitem').filter({ hasText: 'Guest 14' }));
  const row = a.page.getByRole('list', { name: 'In the room' }).filter({ visible: true });
  const invite = row.getByRole('button', { name: 'Invite' });
  await t.see('Invite stays beside the count', invite);
  t.check('and all of it is inside the row', await invite.evaluate((button) => {
    const seats = button.closest('ul').getBoundingClientRect();
    return button.getBoundingClientRect().right <= seats.right + 0.5;
  }));
  bots.forEach((bot) => bot.close());
});

flow('track: everyone together is one tick, a friend behind peels off it, and the player does not move', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a);
  await addByMessage(t, a.page, [golden.url]);
  await joinRoom(b, room.url);
  const tick = a.page.locator('.front-row .seat-track-room');
  const dots = a.page.locator('.front-row .seat-track-dot');
  await t.see('the room’s tick', tick);
  await t.see('the room clock', a.page.locator('.front-row .seat-track').getByText(/^\d+:\d\d$/));
  const box = () => a.page.locator('[data-player]').evaluate((node) => JSON.stringify(node.getBoundingClientRect()));
  const before = await box();
  // Ben's own first reports would replace the one sent here, so they go first.
  await t.until('Ben is on the room\'s time', async () => (await b.sample())?.health === 'synced', 8000);
  t.eq('together, nobody has a dot', await dots.count(), 0);
  await b.page.evaluate(() => window.__net.send('status', { state: 'correcting', drift: -12 }));
  await t.until('Ben falls behind on the track', async () => {
    if ((await dots.count()) !== 1) return false;
    const [behind, here] = await Promise.all([dots.first(), tick].map((mark) => mark.evaluate((node) => node.getBoundingClientRect().left)));
    return here - behind > 100;
  });
  t.eq('the player did not move', await box(), before);
  const clear = await a.page.evaluate(() => document.querySelector('.front-row .seat-track').getBoundingClientRect().top >= document.querySelector('[data-player]').getBoundingClientRect().bottom);
  t.check('the track is off the player', clear);
});

flow('moments: a reaction comes from the person, with their face still showing', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await react(b.page, '🔥');
  const seat = ui.seat(a.page, 'Ben');
  await t.see('it lands on their seat', seat.getByText('🔥'));
  await t.see('and their initial is still there', seat.getByText('B', { exact: true }));
  t.eq('nobody else\'s seat', await seats(a.page).getByText('🔥').count(), 1);
  await t.see('it marks the track too', a.page.locator('.front-row .seat-track').getByText('🔥'));
  await t.gone('and the seat lets it go', seat.getByText('🔥'), 5000);
});

flow('moments: the wake drifts with the video, and waits when the room waits', { timeout: 60_000 }, async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a);
  await addByMessage(t, a.page, [sample(t.base)]);
  await joinRoom(b, room.url);
  await t.until('both play', async () => (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing'), 12_000);
  await react(b.page, '😂');
  const mark = a.page.locator('.front-row .wake-mark > span');
  await t.see('a mark on the track', mark);
  const left = () => mark.evaluate((node) => node.getBoundingClientRect().left);
  const first = await left();
  await t.sleep(2000);
  const moved = await left();
  t.check('it falls behind the playhead', moved < first - 10, `${first} to ${moved}`);
  await player(b.page).pause();
  await t.see('the room stops', ui.bar(a.page).getByText(/Paused by Ben/));
  const held = await left();
  await t.sleep(1000);
  t.check('it stops with the room', Math.abs((await left()) - held) < 1, `${held} to ${await left()}`);
});

flow('moments: a pause brings the lights up, whoever did it stands, and the row looks at them', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a);
  await addByMessage(t, a.page, [sample(t.base)]);
  await joinRoom(b, room.url);
  await t.until('both play', async () => (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing'), 12_000);
  const lights = () => a.page.locator('.room-shell').getAttribute('data-lights');
  const ground = () => a.page.evaluate(() => Number(getComputedStyle(document.querySelector('.room-shell'), '::before').opacity));
  await t.until('lights go down when it plays', async () => (await lights()) === 'down' && (await ground()) === 0, 4000);
  const top = (name) => ui.seat(a.page, name).locator('span').first().evaluate((node) => node.getBoundingClientRect().top);
  await t.sleep(1000); // Ben has only just sat down, and that's a moment of its own.
  const rest = await top('Ben');
  await player(b.page).pause();
  await t.see('who paused', ui.bar(a.page).getByText(/Paused by Ben/));
  await t.until('lights come up', async () => (await ground()) > 0.3, 3000);
  await t.sleep(600);
  t.check('Ben is up', (await top('Ben')) < rest, `${await top('Ben')} from ${rest}`);
  t.check('and the others have sat back', (await top('You')) > rest, `${await top('You')} from ${rest}`);
  const turned = await ui.seat(a.page, 'You').locator('.avatar-face').evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41);
  t.check('and turned to look at him', turned > 0, String(turned));
  const headroom = await ui.seat(a.page, 'Ben').locator('.seat-disc').evaluate((node) => node.getBoundingClientRect().top - 4 - node.closest('.front-row').getBoundingClientRect().top);
  t.check('his ring stays in the row', headroom >= 0, String(headroom));
  t.check('the player is not touched', await a.page.evaluate(() => document.querySelector('.front-row').getBoundingClientRect().top >= document.querySelector('[data-player]').getBoundingClientRect().bottom));
  await ui.bar(a.page).getByRole('button', { name: 'Resume for everyone' }).click();
  await t.until('lights go down again', async () => (await ground()) === 0, 4000);
  await t.until('and everyone sits level', async () => Math.abs((await top('Ben')) - rest) < 0.5, 2000);
});

flow('moments: with reduced motion the news still arrives and nothing moves', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  await a.page.emulateMedia({ reducedMotion: 'reduce' });
  const room = await startRoom(t, a);
  await addByMessage(t, a.page, [sample(t.base)]);
  await joinRoom(b, room.url);
  await t.until('both play', async () => (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing'), 12_000);
  await react(b.page, '😂');
  const said = ui.seat(a.page, 'Ben').getByText('😂');
  await t.see('the reaction shows', said);
  await t.sleep(1000);
  t.check('and can still be read a second on', Number(await said.evaluate((node) => getComputedStyle(node).opacity)) > 0.9);
  const mark = a.page.locator('.front-row .wake-mark > span');
  const first = await mark.evaluate((node) => node.getBoundingClientRect().left);
  await t.sleep(800);
  t.eq('the mark stays on the playhead', await mark.evaluate((node) => node.getBoundingClientRect().left), first);
  const top = () => ui.seat(a.page, 'Ben').locator('span').first().evaluate((node) => node.getBoundingClientRect().top);
  const rest = await top();
  await player(b.page).pause();
  await t.see('the pause is said', ui.bar(a.page).getByText(/Paused by Ben/));
  await t.sleep(200);
  t.eq('and nobody moves for it', await top(), rest);
});

flow('moments: someone reloading keeps their seat, held in their colour', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.see('Ben sits', seats(a.page).getByText('Ben'));
  await b.page.goto('about:blank');
  const held = seats(a.page).locator('[data-away=true]');
  await t.see('his seat waits', held.getByText('Ben'), 8000);
  await joinRoom(b, room.url);
  await t.gone('and it is his again', held, 8000);
  t.eq('one Ben', await seats(a.page).getByText('Ben').count(), 1);
});

flow('moments: everyone who sits down at once is one line', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const bots = await crowd(t, room.slug, 6, (i) => ['Sam', 'Priya', 'Theo', 'Lena', 'Noor', 'Ravi'][i]);
  await t.see('the status line counts them', ui.bar(a.page).getByText(/others took seats/));
  await t.until('the chat has one line for them', async () => (await ui.chatLog(a.page).getByText(/took seats/).count()) === 1);
  t.eq('and nobody gets a line each', await ui.chatLog(a.page).getByText(/joined/).count(), 0);
  bots.forEach((bot) => bot.close());
});

flow('moments: the queue ends with what was on and whose idea it was', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await addByMessage(t, b.page, [train.url]);
  await t.see('the next is queued', ui.tab(a.page, 'Queue').getByText('1'));
  await ui.skip(a.page).click();
  await t.see('whose pick it is', ui.bar(a.page).getByText(/Ben picked this/));
  await ui.skip(a.page).click();
  await t.see('finished', ui.stageHeading(a.page));
  const credits = a.page.getByRole('list', { name: 'What the room watched' });
  await t.see('the credits', credits.getByText(golden.title));
  await t.see('and the second', credits.getByRole('listitem').filter({ hasText: train.title }).getByText('Ben'));
});

flow('moments: theatre mode passes on what a friend says, off the video', async (t) => {
  const a = await t.person('Ana', { viewport: { width: 1440, height: 800 } });
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await a.page.getByRole('button', { name: 'Theatre' }).click();
  await t.gone('the rail', ui.rail(a.page));
  await sendChat(b.page, 'wait for this part');
  await t.see('the bar has it', ui.bar(a.page).getByRole('status').getByText('wait for this part'));
  t.check('under the video', await a.page.evaluate(() => document.querySelector('.player-bar [role=status]').getBoundingClientRect().top >= document.querySelector('[data-player]').getBoundingClientRect().bottom));
  await t.gone('and it goes', ui.bar(a.page).getByRole('status'), 8000);
});

flow('invite: the seat you offered is held until someone takes it', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.see('an empty seat', seats(a.page).getByText('Save a seat'));
  await ui.invite(a.page).click();
  await t.see('held', seats(a.page).getByText('Seat saved'));
  const c = await t.person('Cal');
  await joinRoom(c, room.url);
  await t.see('taken, and the next one offered', seats(a.page).getByText('Save a seat'));
});

flow('leave: Leave goes home, the room hears, and the landing offers the way back', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await b.page.getByRole('link', { name: 'Leave', exact: true }).click();
  await t.see('home', ui.linkBox(b.page));
  await t.see('Ana hears', ui.chatLog(a.page).getByText('Ben left'), 12_000);
  const back = b.page.getByRole('link', { name: /Back to/ });
  await t.see('the way back', back);
  await back.click();
  await reenter(b.page);
  await t.see('in again', ui.bar(b.page).getByRole('heading', { name: golden.title }));
});

flow('leave: a room that has since closed offers no way back to it', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  await a.page.getByRole('link', { name: 'Leave', exact: true }).click();
  await t.see('the way back', a.page.getByRole('link', { name: /Back to/ }));
  await t.stack.sql(`UPDATE rooms SET closed_at = now() WHERE slug = '${room.slug}'`);
  await a.page.reload();
  await t.see('home', ui.linkBox(a.page));
  await t.gone('the way back', a.page.getByRole('link', { name: /Back to/ }));
});

const firstThumb = (strip) => strip.locator('.up-next-thumb').first().evaluate((thumb) => Math.round(thumb.getBoundingClientRect().left));

flow('dock: Popular and Up next share one geometry, and watching never swaps them', async (t) => {
  const a = await t.person('Ana');
  await startRoom(t, a);
  const popular = a.page.locator('main section[aria-label="Popular on YouTube"]');
  const pick = popular.getByRole('button', { name: new RegExp(train.title) }).first();
  await t.see('a suggestion with nothing on', pick);
  const popularX = await firstThumb(popular);
  await pick.click();
  await t.gone('it plays, so suggestions go', popular);
  await addByMessage(t, a.page, [golden.url]);
  const upNext = a.page.getByRole('region', { name: 'Up next in the queue' });
  await t.see('it is queued', upNext.getByRole('listitem').filter({ hasText: golden.title }));
  t.eq('the first thumbnail starts at the same x', await firstThumb(upNext), popularX);
  await openTab(a.page, 'Queue');
  await t.see('Up next stays with the queue open', upNext.getByRole('listitem').filter({ hasText: golden.title }));
  t.eq('and Popular does not come back', await popular.count(), 0);
});

flow('links: a stranger with a catch-up link reaches the gate, and a dead recap link says so', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: golden.url });
  const b = await t.person('Ben');
  await b.page.goto(`${t.base}/r/${room.slug}/catchup/nothing`);
  await t.see('the gate', ui.join(b.page));
  await b.page.goto(`${t.base}/s/no-such-token`);
  await t.see('a recap that is not shared', b.page.getByRole('heading', { name: /recap isn.t shared/ }));
});
