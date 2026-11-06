import { addByMessage, joinRoom, openTab, player, react, reenter, sample, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');
const rain = video('Rainy Window');

/** The first seconds after a join have a flow of their own, so most flows wait them out. */
const watching = async (t, url, { settle = 3000 } = {}) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url });
  await joinRoom(b, room.url);
  await t.until('both play', async () =>
    (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing' && s.time > 0.5), 12_000);
  // A joiner a moment ahead is held still for about 250ms around two seconds in, and a
  // pause then is lost: the player is already paused, so nothing fires. See P-08.
  await t.sleep(settle);
  await t.until('both still playing', async () =>
    (await Promise.all([a.sample(), b.sample()])).every((s) => s?.state === 'playing'));
  return { a, b, room };
};

const apart = (x, y) => Math.abs((x.time - x.expected) - (y.time - y.expected));

for (const [label, source] of [['a file', (t) => sample(t.base)], ['YouTube', () => golden.url]]) {
  flow(`playback (${label}): pause and play reach everyone, and say who did it`, async (t) => {
    const { a, b } = await watching(t, source(t));
    await player(b.page).pause();
    await t.until('Ana stops', async () => (await a.sample())?.state === 'paused');
    await t.see('Ana is told who', ui.bar(a.page).getByText(/Paused by Ben at \d+:\d\d/));
    await t.see('Ben is told it was him', ui.bar(b.page).getByText(/Paused by you at/));
    await t.sleep(2500);
    t.eq('Ana stays paused', (await a.sample())?.state, 'paused');
    await player(a.page).play();
    await t.until('Ben resumes', async () => (await b.sample())?.state === 'playing');
    await t.see('the status clears for Ben', ui.bar(b.page).getByText(/everyone together/), 8000);
    await t.until('they are together again', async () => apart(await a.sample(), await b.sample()) < 0.5, 8000);
  });

  flow(`playback (${label}): a seek moves everyone and says how far`, async (t) => {
    const { a, b } = await watching(t, source(t));
    await player(b.page).seek(120);
    await t.until('Ana lands there', async () => (await a.sample())?.time > 118, 8000);
    await t.see('the status says it', ui.bar(a.page).filter({ hasText: /Ben moved to 2:0\d/ }));
    await player(a.page).seek(30);
    await t.until('Ben comes back', async () => {
      const now = await b.sample();
      return now.time > 28 && now.time < 45;
    }, 8000);
    await t.see('and that too', ui.bar(b.page).filter({ hasText: /Ana moved to 0:3\d/ }));
  });
}

flow('playback: a seek in the first moment after joining still counts', async (t) => {
  const { a, b } = await watching(t, sample(t.base), { settle: 0 });
  await player(b.page).seek(120);
  await t.until('Ana lands there', async () => (await a.sample())?.time > 118, 8000);
  await t.sleep(2500);
  t.check('Ben stays there', (await b.sample())?.time > 118, String((await b.sample())?.time));
});

flow('playback: someone joining late lands where the room is', async (t) => {
  const { a, room } = await watching(t, sample(t.base));
  await player(a.page).seek(100);
  await t.until('the room moved', async () => (await a.sample())?.time > 99, 8000);
  const c = await t.person('Cal');
  await joinRoom(c, room.url);
  await t.until('Cal is in step', async () => {
    const [x, y] = await Promise.all([a.sample(), c.sample()]);
    return y?.state === 'playing' && apart(x, y) < 0.5;
  }, 12_000);
});

flow('playback: a reload comes back to the same moment', async (t) => {
  const { a, b } = await watching(t, sample(t.base));
  await player(a.page).seek(100);
  await t.until('moved', async () => (await b.sample())?.time > 99, 8000);
  await b.page.reload();
  await reenter(b.page);
  await t.until('Ben is back in step', async () => {
    const [x, y] = await Promise.all([a.sample(), b.sample()]);
    return y?.state === 'playing' && apart(x, y) < 0.5;
  }, 12_000);
});

flow('playback: a paused room stays paused for a late joiner', async (t) => {
  const { a, room } = await watching(t, sample(t.base));
  await player(a.page).seek(50);
  await t.until('moved', async () => (await a.sample())?.time > 49, 6000);
  await player(a.page).pause();
  await t.see('paused', ui.bar(a.page).getByText('Paused by you'));
  const c = await t.person('Cal');
  await joinRoom(c, room.url);
  await t.see('Cal is told who', ui.bar(c.page).getByText('Paused by Ana'));
  await t.until('Cal rests on the same frame', async () => {
    const now = await c.sample();
    return now?.state === 'paused' && Math.abs(now.time - (await a.sample()).time) < 0.3;
  }, 10_000);
});

flow('skip: moves everyone to the next video and says what it is', async (t) => {
  const { a, b } = await watching(t, golden.url);
  await addByMessage(t, a.page, [train.url, rain.url]);
  await t.see('the Skip button', ui.bar(a.page).getByRole('button', { name: 'Skip' }));
  await ui.skip(b.page).click();
  await t.see('Ana moved on', ui.bar(a.page).getByRole('heading', { name: train.title }));
  await t.see('Ben moved on', ui.bar(b.page).getByRole('heading', { name: train.title }));
  await t.see('the chat says it', ui.chatLog(a.page).getByText(`Ben skipped to ${train.title}`));
  await openTab(a.page, 'Queue');
  await t.gone('it left the queue', ui.upNext(a.page).getByText(train.title));
  await t.see('one left in the queue', ui.tab(a.page, 'Queue').getByText('1'));
});

flow('skip: the last video ends the room, back to the stage', async (t) => {
  const { a, b } = await watching(t, golden.url);
  await t.see('Finish, with nothing queued', ui.bar(a.page).getByRole('button', { name: 'Finish' }));
  await ui.skip(a.page).click();
  await t.see('Ana sees the stage', ui.stageHeading(a.page));
  await t.see('Ben sees the stage', ui.stageHeading(b.page));
  await t.gone('the player', ui.bar(b.page));
  await ui.addBox(b.page).fill(train.url);
  await ui.addBox(b.page).press('Enter');
  await t.see('adding starts it for everyone', ui.bar(a.page).getByRole('heading', { name: train.title }));
  await t.until('and it plays', async () => (await a.sample())?.state === 'playing');
});

flow('end of video: a real file finishes and the next starts for everyone', { timeout: 60_000 }, async (t) => {
  const { a, b } = await watching(t, sample(t.base, 'short.mp4'), { settle: 0 });
  await addByMessage(t, a.page, [sample(t.base, 'sample.mp4', 'next')]);
  await t.see('Ana moves on', ui.bar(a.page).getByRole('heading', { name: 'sample.mp4' }), 14_000);
  await t.see('Ben moves on', ui.bar(b.page).getByRole('heading', { name: 'sample.mp4' }));
  t.eq('the heading says it, so the chat needn\'t', await ui.chatLog(b.page).getByText('Up next: sample.mp4').count(), 0);
  t.check('nobody is blamed for the pause at the end', !(await ui.chatLog(a.page).getByText(/paused at/).isVisible()));
  await t.until('the next one plays', async () => (await b.sample())?.state === 'playing' && (await b.sample()).time < 10, 8000);
});

flow('end of video: YouTube ending moves the room on, once', { timeout: 60_000 }, async (t) => {
  const clip = video('Six second clip');
  const { a, b } = await watching(t, clip.url);
  await addByMessage(t, a.page, [train.url, rain.url]);
  await t.see('Ana moves on', ui.bar(a.page).getByRole('heading', { name: train.title }), 14_000);
  await t.see('Ben moves on', ui.bar(b.page).getByRole('heading', { name: train.title }));
  await t.sleep(1500);
  await openTab(b.page, 'Queue');
  t.eq('only one video was used up', await ui.upNext(b.page).getByText(rain.title).count(), 1);
});

flow('end of queue: the last video finishing says so, and the room can go on', { timeout: 60_000 }, async (t) => {
  const { a, b } = await watching(t, sample(t.base, 'short.mp4'), { settle: 0 });
  await t.see('the end message', ui.stageHeading(a.page), 14_000);
  await t.see('for Ben too', ui.stageHeading(b.page));
  await t.see('a way to go on', ui.addBox(a.page));
});

flow('broken video: one that refuses embedding is skipped with a way to watch it', { timeout: 30_000 }, async (t) => {
  const blocked = video('Owner blocks embedding');
  const { a, b } = await watching(t, golden.url);
  await addByMessage(t, a.page, [blocked.url, train.url]);
  await ui.skip(a.page).click();
  await t.see('the notice', a.page.getByText(/Skipped .* YouTube won.t let it play here/));
  await t.see('a way out', a.page.getByRole('link', { name: 'Open on YouTube' }));
  await t.see('both land on the next one', ui.bar(b.page).getByRole('heading', { name: train.title }));
});

flow('broken video: a room left with only a dead video recovers', { timeout: 30_000 }, async (t) => {
  const gone = video('Removed after');
  const a = await t.person('Ana');
  await startRoom(t, a, { url: gone.url });
  await t.see('the notice', a.page.getByText(/Skipped .* wouldn.t load/));
  await t.see('the stage', ui.stageHeading(a.page));
});

flow('broken video: two people seeing a block hide it from search', { timeout: 30_000 }, async (t) => {
  const blocked = video('Owner blocks embedding');
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: blocked.url });
  await joinRoom(b, room.url).catch(() => {});
  await t.see('it was skipped', a.page.getByText(/Skipped/));
});

flow('sound: a first visit with no click starts muted and offers sound', { timeout: 30_000 }, async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a, { url: sample(t.base) });
  const b = await t.person('Ben', { strictAutoplay: true });
  await b.page.goto(room.url);
  await t.see('Join', ui.join(b.page));
  await ui.join(b.page).click();
  await t.see('the video', ui.bar(b.page).getByRole('heading', { name: 'sample.mp4' }));
  await t.until('the Join click allowed sound', async () => (await b.sample())?.state === 'playing', 8000);
  // Nothing has been clicked in this profile, which the gate normally rules out.
  // An init script, because page.evaluate counts as a gesture.
  const c = await t.person('Cal', { strictAutoplay: true });
  await c.context.addInitScript(() => history.replaceState({ joined: true }, ''));
  await c.page.goto(room.url);
  await t.see('without a click, the offer', ui.bar(c.page).getByRole('button', { name: /unmute/i }), 8000);
  await ui.bar(c.page).getByRole('button', { name: /unmute/i }).click();
  await t.gone('the offer', ui.bar(c.page).getByRole('button', { name: /unmute/i }));
  t.eq('sound is on', await c.page.evaluate(() => document.querySelector('video').muted), false);
});

flow('theatre: T hides the rail, keeps a draft and brings it back', async (t) => {
  const { a, b } = await watching(t, golden.url);
  await ui.chatBox(a.page).fill('half a thought');
  await a.page.getByRole('heading', { level: 2, name: golden.title }).click();
  await a.page.keyboard.press('t');
  await t.gone('the rail', ui.rail(a.page));
  await react(b.page, '🔥');
  await t.see('a reaction shows in the bar', ui.bar(a.page).getByText('🔥'));
  await a.page.keyboard.press('t');
  await t.see('the rail', ui.rail(a.page));
  t.eq('the draft survives', await ui.chatBox(a.page).inputValue(), 'half a thought');
  await a.page.getByRole('button', { name: 'Theatre' }).click();
  await t.gone('the rail, by button', ui.rail(a.page));
  await a.page.getByRole('button', { name: 'Theatre' }).click();
  await t.see('and back', ui.rail(a.page));
});

flow('theatre: typing a t in the chat does not trigger it', async (t) => {
  const { a } = await watching(t, golden.url);
  await ui.chatBox(a.page).click();
  await a.page.keyboard.type('that took a while');
  t.check('the rail stays', await ui.rail(a.page).isVisible());
  t.eq('all of it typed', await ui.chatBox(a.page).inputValue(), 'that took a while');
});
