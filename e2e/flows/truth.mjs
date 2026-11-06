import { addByMessage, joinRoom, player, startRoom, ui } from '../lib/app.mjs';
import { PHONE } from '../lib/client.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';
import { truthReport, watchTruth } from '../lib/truth.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');

const line = (page, text) => ui.bar(page).getByText(text);
const resume = (page) => ui.bar(page).getByRole('button', { name: 'Resume for everyone', exact: true });

const watching = async (t, options) => {
  const a = await t.person('Ana', options);
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.until('playing', async () => (await a.sample())?.time > 0.5 && (await b.sample())?.time > 0.5);
  await Promise.all([watchTruth(a.page), watchTruth(b.page)]);
  return { a, b };
};

const noContradictions = async (t, ...people) => {
  for (const { name, page } of people) {
    const { clashes, over } = await truthReport(page);
    t.eq(`${name}: no two surfaces disagreed`, clashes.join('; '), '');
    t.eq(`${name}: nothing sat on the player`, over.join('; '), '');
  }
};

flow('truth: pausing and carrying on, every surface says the same on every frame', async (t) => {
  const { a, b } = await watching(t);
  await t.see('steady', line(a.page, /Playing at \d+:\d\d, everyone together/), 8000);
  await player(b.page).pause();
  await t.see('who paused', line(a.page, /Paused by Ben at \d+:\d\d/));
  await t.see('Resume, while the player is long started', resume(a.page));
  await t.sleep(2500);
  await t.see('Resume stays', resume(a.page));
  await t.gone('no Loading', a.page.getByText('Loading…'), 500);
  await resume(a.page).click();
  await t.see('steady again', line(b.page, /everyone together/), 8000);
  await noContradictions(t, a, b);
});

flow('truth: offline never promises what the room is not doing', async (t) => {
  const { a, b } = await watching(t);
  await player(a.page).pause();
  await t.see('paused', line(b.page, /Paused by Ana/));
  await b.offline();
  await t.see('paused stays paused', line(b.page, 'Reconnecting. Your video stays paused.'), 3000);
  await b.online();
  await t.see('back', line(b.page, /Paused by Ana/), 10_000);
  await noContradictions(t, a, b);
});

flow('truth: a viewer whose player failed is told where the room is', async (t) => {
  const { a, b } = await watching(t);
  await b.page.evaluate(() => window.__yt.events.onError({ data: 150, target: window.__yt }));
  await t.see('just you', b.page.getByText(/It.s just you/));
  await t.see('Ana watches on', b.page.getByText(/Ana is still watching/));
  await t.see('the room’s time', line(b.page, /The room is at \d+:\d\d/));
  await player(a.page).pause();
  await t.see('where the room is', line(b.page, /The room is paused at \d+:\d\d/));
  await t.see('Ana is not watching a paused room', b.page.getByText(/Ana can play it/));
  await noContradictions(t, a, b);
});

flow('truth: someone who paused and left stops being named', async (t) => {
  const { a, b } = await watching(t);
  await player(b.page).pause();
  await t.see('named', line(a.page, /Paused by Ben/));
  const { clashes } = await truthReport(a.page);
  t.eq('no two surfaces disagreed', clashes.join('; '), '');
  await b.page.goto('about:blank');
  await t.see('not named', line(a.page, /^Paused at \d+:\d\d$/), 15_000);
});

flow('truth: a skip shows only the next video, with nothing on the stage', async (t) => {
  const { a, b } = await watching(t);
  await addByMessage(t, a.page, [train.url]);
  await ui.skip(a.page).click();
  await t.see('the new title', ui.bar(b.page).getByRole('heading', { name: train.title }));
  await t.until('it plays', async () => (await b.sample())?.state === 'playing');
  t.eq('no Up next on the stage', await b.page.getByText(/^Up next:/).count(), 0);
  await noContradictions(t, a, b);
});

flow('truth: Resume keeps its whole label on a phone', async (t) => {
  const { a, b } = await watching(t, { viewport: PHONE, phone: true });
  await player(b.page).pause();
  await t.see('the whole label', resume(a.page));
  const box = await resume(a.page).boundingBox();
  t.check('inside the screen', box && box.x >= 0 && box.x + box.width <= PHONE.width, JSON.stringify(box));
  await t.until('and the status isn’t cut off to fit it', () => a.page.evaluate(() => {
    const words = [...document.querySelectorAll('[data-room-status] span')].find((line) => line.getClientRects().length > 0);
    return words && words.scrollWidth <= words.clientWidth;
  }));
  await noContradictions(t, a, b);
});
