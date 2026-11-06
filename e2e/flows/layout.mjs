import { joinRoom, openTab, player, react, search, seedRoom, sendChat, startRoom, ui } from '../lib/app.mjs';
import { crowd } from '../lib/bots.mjs';
import { byId, video, youtube } from '../lib/fixtures.mjs';
import { blockedControls, gutters, insets, playerCover, sideScroll, spills } from '../lib/layout.mjs';
import { flow } from '../lib/runner.mjs';

const rain = video('Rainy Window'); // Not the flows' next video, or the strip has two of one title.

/** Runs in the page: the words a reaction's emoji or name is on right now, as far as anyone can see them. */
const reactionsOnWords = () => {
  const box = (el) => el.getBoundingClientRect();
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const lane = box(document.querySelector('.reaction-lane'));
  const log = box(document.querySelector('[role=log]'));
  const words = [...document.querySelectorAll('[role=log] p')].flatMap((line) => {
    const range = document.createRange();
    range.selectNodeContents(line);
    return [...range.getClientRects()].filter((rect) => hit(rect, log));
  });
  const shown = [...document.querySelectorAll('.reaction-emoji, .reaction-name')].filter((el) => hit(box(el), lane));
  const on = shown.flatMap((el) => words.filter((rect) => hit(box(el), rect)).map((rect) =>
    `${el.textContent} ${Math.round(box(el).left)}-${Math.round(box(el).right)} on a line ending ${Math.round(rect.right)}`));
  return { shown: shown.length, on };
};

const WIDTHS = [
  { width: 390, height: 844, phone: true },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

const NAMES = ['Zoë O’Brien-Müller the Third', '하늘이 🌸', '🎬🍿🎬🍿🎬🍿🎬🍿', 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
  'محمد الأحمد', 'さくら', 'Al', 'NoSpacesNoSpacesNoSpacesNoSpaces', 'Ana', 'Ben', 'Cal', 'Dee'];

const LINES = [
  'hi', 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
  'x'.repeat(240), '😂'.repeat(60), `this one has a long link https://www.youtube.com/watch?v=${video('Night Train').id}&list=PL${'a'.repeat(60)} in it`,
  '오늘 영상 진짜 재밌다 다음에는 뭐 볼까요? 추천해 주세요!!', 'مرحبا بالجميع، هذا الفيديو رائع جدا', 'short', 'wait for this part',
  `${'long sentence that wraps over several lines in the narrowest rail '.repeat(4)}`, '👨‍👩‍👧‍👦🏳️‍🌈👨‍👩‍👧‍👦🏳️‍🌈👨‍👩‍👧‍👦🏳️‍🌈',
];

const seconds = (iso) => {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) ?? [];
  return [86400, 3600, 60, 1].reduce((sum, unit, i) => sum + Number(match[i + 1] ?? 0) * unit, 0);
};

const decode = (text) => text.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');

/** A queue of everything awkward in the fixtures, twice over. */
const messyQueue = () => {
  const playable = youtube.videos.filter((one) => !one.playerError && one.status.embeddable && one.status.privacyStatus === 'public' && one.snippet.liveBroadcastContent === 'none');
  return [...playable, ...playable].map((one, i) => ({
    id: `q${i}`, source: 'youtube', sourceId: one.id, url: `https://www.youtube.com/watch?v=${one.id}`,
    title: decode(one.snippet.title), author: decode(one.snippet.channelTitle),
    thumbnailUrl: one.snippet.thumbnails.high?.url ?? '', durationMs: seconds(one.contentDetails.duration) * 1000,
    isLive: false, addedBy: 'x', addedByName: NAMES[i % NAMES.length],
  }));
};

const seedChat = async (t, slug, owner) => {
  const quote = (text) => `$q$${text}$q$`;
  const rows = Array.from({ length: 48 }, (_, i) => `((SELECT id FROM rooms WHERE slug = ${quote(slug)}), ${quote(owner)}, ${quote(NAMES[i % NAMES.length])}, ${quote(LINES[i % LINES.length].slice(0, 500))})`);
  await t.stack.sql(`INSERT INTO messages (room_id, user_id, author_name, body) VALUES ${rows.join(',')}`);
};

/** The worst room we can think of, reached the way anyone reaches it. */
const messyRoom = async (t) => {
  const host = await t.person('host');
  const title = video('바이, 썸머');
  const room = await startRoom(t, host, { url: title.url, name: NAMES[0] });
  await seedRoom(t, room.slug, (state) => {
    state.queue[0].addedByName = NAMES[0];
    state.queue.push(...messyQueue());
  });
  await seedChat(t, room.slug, await t.stack.sql(`SELECT owner_id FROM rooms WHERE slug = '${room.slug}'`));
  const bots = await crowd(t, room.slug, 11, (i) => NAMES[i + 1]);
  // The seeded lines are all one person's, so only the first carries an avatar.
  bots.slice(0, 3).forEach((bot, i) => bot.say(LINES[i + 6]));
  return { host, room, bots };
};

/** One shell: the height of the bar, and where the mark sits in it. */
const shellBar = (page) =>
  page.getByRole('banner').evaluate((bar) => `${bar.getBoundingClientRect().height} tall, mark at ${bar.querySelector('svg').getBoundingClientRect().x}`);

/** Touching, or close enough to read as touching. */
const LEFT_MIN = 4;

/** One gutter for the whole rail: every surface starts and ends on the same line. */
const checkGutters = (t, where, measured) => {
  for (const [name, gutter] of Object.entries(measured)) {
    t.check(`${where}: ${name} clears the left edge`, gutter.left >= LEFT_MIN, `${gutter.left}px, ${gutter.leftmost}`);
    t.check(`${where}: ${name} clears the right edge`, gutter.right >= LEFT_MIN, `${gutter.right}px, ${gutter.rightmost}`);
  }
  return measured;
};

const report = (seen, width, tab, measured) => {
  for (const [name, gutter] of Object.entries(measured)) {
    seen.push({ width, tab, surface: name, ...gutter });
  }
};

/** Everything starts on one line. Text is ragged on the right, so there it only must not cross it. */
const shareOneGutter = (t, width, seen) => {
  const rows = seen.filter((row) => row.width === width);
  const lefts = rows.map((row) => row.left);
  const list = (side) => rows.map((row) => `${row.surface} ${row[side]}`).join(', ');
  t.check(`${width}: every rail surface shares one left gutter`, Math.max(...lefts) - Math.min(...lefts) <= 1, list('left'));
  t.check(`${width}: nothing runs past that gutter on the right`,
    Math.min(...rows.map((row) => row.right)) >= Math.min(...lefts) - 1, list('right'));
};

const checkSpills = async (t, where, page, frame) => {
  const problems = await spills(page, frame);
  // One root cause can hit every row, so one line per kind, with a count.
  for (const kind of new Set(problems.map((problem) => problem.kind))) {
    const hits = problems.filter((problem) => problem.kind === kind);
    t.check(`${where}: ${kind}`, false, `${hits.length}x, first "${hits[0].what}" ${hits[0].detail}`);
  }
  t.check(`${where}: nothing spills`, true);
};

const checkBreathing = async (t, where, page, locator) => {
  const room = await insets(page, locator);
  t.check(`${where}: nothing touches its top or bottom`, room && room.top >= LEFT_MIN && room.bottom >= LEFT_MIN, JSON.stringify(room));
};

const checkPlayer = async (t, where, page) => {
  const cover = await playerCover(page);
  if (!cover) return;
  t.check(`${where}: nothing covers the player`, cover.hits.length === 0, JSON.stringify(cover.hits));
  t.check(`${where}: the player is at least 200 by 200`, cover.width >= 200 && cover.height >= 200, `${cover.width} by ${cover.height}`);
};

const checkPage = async (t, where, page) => {
  const over = await sideScroll(page);
  t.check(`${where}: no sideways scroll`, over <= 0, `${over}px`);
  const blocked = await blockedControls(page);
  t.check(`${where}: every control can be reached`, blocked.length === 0, blocked.slice(0, 4).join('; '));
};

for (const { width, height, phone } of [...WIDTHS, { width: 844, height: 390, phone: true }]) {
  flow(`layout ${width}: a reaction crosses nobody's words`, { timeout: 60_000 }, async (t) => {
    const host = await t.person('host', { viewport: { width, height }, phone });
    const guest = await t.person('Bartholomew the Long');
    const room = await startRoom(t, host, { url: video('Golden Hour').url });
    await joinRoom(guest, room.url);
    for (const line of [LINES[9], LINES[1], LINES[2]]) await sendChat(guest.page, line.slice(0, 200));
    await t.see('the long lines', ui.chatLog(host.page).getByText(LINES[2].slice(0, 200)));
    const on = new Set();
    let shown = 0;
    const watching = (async () => {
      for (const end = Date.now() + 6000; Date.now() < end;) {
        const sample = await host.page.evaluate(reactionsOnWords);
        shown = Math.max(shown, sample.shown);
        sample.on.forEach((one) => on.add(one));
      }
    })();
    for (const emoji of ['🔥', '😂', '❤️', '👏']) await react(guest.page, emoji);
    await watching;
    t.check(`${width}: reactions rose`, shown > 0);
    t.check(`${width}: no emoji or name is on a chat line`, on.size === 0, [...on].slice(0, 3).join('; '));
  });
}

for (const size of WIDTHS) {
  const { width, height, phone } = size;

  flow(`layout ${width}: the rail keeps one gutter and nothing spills, with messy content`, { timeout: 120_000 }, async (t) => {
    const { room, bots } = await messyRoom(t);
    const viewer = await t.person('viewer', { viewport: { width, height }, phone });
    await joinRoom(viewer, room.url, { name: NAMES[1] });
    const { page } = viewer;
    const rail = ui.rail(page);
    const seen = [];

    await ui.tab(page, 'Chat').click();
    await t.see('the chat', ui.chatLog(page).getByText('short'));
    report(seen, width, 'chat', checkGutters(t, `${width} chat`, await gutters(page)));
    await checkSpills(t, `${width} chat`, page, rail);
    await checkPage(t, `${width} chat`, page);
    await checkPlayer(t, `${width} chat`, page);

    await ui.chatLog(page).getByRole('button', { name: 'Add to queue' }).last().click();
    await t.see('a notice', rail.locator('[aria-live] p'));
    await checkPage(t, `${width} chat with a notice`, page);

    await openTab(page, 'Queue');
    await t.see('the long queue', ui.upNext(page).getByRole('listitem'));
    report(seen, width, 'queue', checkGutters(t, `${width} queue`, await gutters(page)));
    await checkSpills(t, `${width} queue`, page, rail);
    await checkPage(t, `${width} queue`, page);

    await search(page, 'mix');
    await t.see('the results', ui.results(page).getByRole('listitem'));
    report(seen, width, 'search', checkGutters(t, `${width} search`, await gutters(page)));
    await checkSpills(t, `${width} search`, page, rail);
    await page.keyboard.press('Escape');

    await openTab(page, 'People');
    await t.see('the people', rail.getByRole('listitem').filter({ hasText: NAMES[3].slice(0, 8) }));
    report(seen, width, 'people', checkGutters(t, `${width} people`, await gutters(page)));
    await checkSpills(t, `${width} people`, page, rail);
    await checkPage(t, `${width} people`, page);

    shareOneGutter(t, width, seen);
    await checkSpills(t, `${width} header`, page, page.getByRole('banner'));
    await checkSpills(t, `${width} player bar`, page, ui.bar(page));
    await checkBreathing(t, `${width} player bar`, page, ui.bar(page));
    await checkBreathing(t, `${width} header`, page, page.getByRole('banner'));
    bots.forEach((bot) => bot.close());
  });

  flow(`layout ${width}: nothing lands on the player, whatever is on screen`, { timeout: 90_000 }, async (t) => {
    const host = await t.person('host', { viewport: { width, height }, phone });
    const guest = await t.person('guest');
    const clip = video('Golden Hour');
    const next = video('Night Train');
    const room = await startRoom(t, host, { url: clip.url });
    await joinRoom(guest, room.url);
    await t.until('it plays', async () => (await host.sample())?.time > 1);
    await checkPlayer(t, `${width} on arrival`, host.page);

    await ui.invite(host.page).click();
    if (!phone) { // A phone gets the share sheet, which is the browser's own.
      await t.see('the invite card', host.page.getByRole('region', { name: 'Invite' }));
      await checkPlayer(t, `${width} with the invite card`, host.page);
      await checkPage(t, `${width} with the invite card`, host.page);
      await host.page.getByRole('button', { name: 'Close' }).click();
      await sendChat(guest.page, rain.url);
      await ui.chatLog(host.page).getByRole('button', { name: 'Add to queue' }).click();
      await t.see('a toast', host.page.getByText('Added to the queue'));
      await checkPlayer(t, `${width} with a toast`, host.page);
      await checkPage(t, `${width} with a toast`, host.page);
      await t.gone('the toast', host.page.getByText('Added to the queue'), 8000);
    }

    await react(guest.page, '🔥');
    await t.see('a reaction', ui.rail(host.page).getByText('🔥'));
    await checkPlayer(t, `${width} with a reaction`, host.page);

    const picker = host.page.getByRole('button', { name: 'Send a reaction' });
    if (await picker.isVisible()) {
      await picker.click();
      await t.see('the picker', host.page.getByRole('button', { name: 'React 😂' }).filter({ visible: true }));
      await checkPlayer(t, `${width} with the picker open`, host.page);
      await host.page.keyboard.press('Escape');
    }

    await guest.page.evaluate((url) => window.__net.send('queue.add', { url, mode: 'end' }), next.url);
    const strip = guest.page.getByRole('region', { name: 'Up next in the queue' });
    await strip.getByRole('button', { name: new RegExp(next.title) }).click();
    await t.see('the jump notice', host.page.getByRole('button', { name: 'Undo' }));
    await t.until('the new video has started', async () => (await host.sample())?.state === 'playing');
    await checkPlayer(t, `${width} with the Undo notice`, host.page);
    await checkPage(t, `${width} with the Undo notice`, host.page);

    await player(host.page).pause();
    await checkPlayer(t, `${width} paused`, host.page);

    await host.offline();
    await t.see('the offline note', host.page.getByRole('status').getByText(/reconnecting/i), 3000);
    await checkPlayer(t, `${width} with the offline bar`, host.page);
  });

  flow(`layout ${width}: the pages around the room hold up`, { timeout: 60_000 }, async (t) => {
    const a = await t.person('a', { viewport: { width, height }, phone });
    await a.page.goto(t.base);
    await t.see('the landing page', ui.linkBox(a.page));
    await checkSpills(t, `${width} landing`, a.page, a.page.locator('body'));
    await checkPage(t, `${width} landing`, a.page);
    const bar = await shellBar(a.page);

    const host = await t.person('host');
    const longTitle = video('전곡 라이브');
    const room = await startRoom(t, host, { url: longTitle.url, name: NAMES[0] });
    await a.page.goto(room.url);
    await t.see('the gate', ui.join(a.page));
    await checkSpills(t, `${width} gate`, a.page, a.page.locator('body'));
    await checkPage(t, `${width} gate`, a.page);
    t.eq(`${width} gate keeps the landing's bar`, await shellBar(a.page), bar);

    await a.page.goto(`${t.base}/r/no-such-room`);
    await t.see('the missing page', a.page.getByRole('heading', { name: /room doesn.t exist/i }));
    await checkSpills(t, `${width} dead end`, a.page, a.page.locator('body'));
    t.eq(`${width} dead end keeps the landing's bar`, await shellBar(a.page), bar);

    await a.page.goto(`${t.base}/no/such/page`);
    await t.see('the not-found page', a.page.getByRole('heading', { name: /nothing.s showing here/i }));
    await checkSpills(t, `${width} not found`, a.page, a.page.locator('body'));
    await checkPage(t, `${width} not found`, a.page);
    t.eq(`${width} not found keeps the landing's bar`, await shellBar(a.page), bar);

    // A phone's room has a way out where the mark would be.
    if (phone) return;
    await a.page.goto(room.url);
    await ui.join(a.page).click();
    await t.see('the room', ui.rail(a.page));
    t.eq(`${width} room keeps the landing's bar`, await shellBar(a.page), bar);
  });

  flow(`layout ${width}: the empty stage holds its results`, { timeout: 60_000 }, async (t) => {
    const a = await t.person('a', { viewport: { width, height }, phone });
    await startRoom(t, a);
    await t.see('the stage', ui.stageHeading(a.page));
    await checkSpills(t, `${width} stage`, a.page, a.page.locator('body'));
    await checkPage(t, `${width} stage`, a.page);
    await search(a.page, 'mix');
    await t.see('results', ui.results(a.page).getByRole('listitem'));
    await checkSpills(t, `${width} stage results`, a.page, ui.results(a.page));
    await checkPage(t, `${width} stage results`, a.page);
    const close = a.page.getByRole('button', { name: 'Close search' });
    await t.expect('the way back', close);
    await t.until('the box stays on screen while results show', async () => {
      const box = await ui.addBox(a.page).boundingBox();
      return box && box.y >= 0;
    });
  });
}

/** A short strip, a taller one, and one tall enough that cards stand up. 1920x1080 leaves no strip to measure. */
for (const { width, height } of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 1024, height: 960 }]) {
  flow(`layout ${width}x${height}: the "more" tile stands as tall as the thumbnails beside it`, { timeout: 60_000 }, async (t) => {
    const { room, bots } = await messyRoom(t);
    const viewer = await t.person('viewer', { viewport: { width, height } });
    await joinRoom(viewer, room.url, { name: NAMES[1] });
    const { page } = viewer;
    const strip = page.getByRole('region', { name: 'Up next in the queue' });
    await t.see('the tile', strip.getByRole('button', { name: /more in the queue/ }));
    const measured = await strip.evaluate((section) => {
      const box = (el) => el.getBoundingClientRect();
      const tile = box(section.querySelector('button[aria-label$="more in the queue"]'));
      const thumbs = [...section.querySelectorAll('.up-next-thumb')].map(box);
      return { tile: [tile.top, tile.bottom].map(Math.round), thumbs: thumbs.map((thumb) => [thumb.top, thumb.bottom].map(Math.round)) };
    });
    t.check(`${width}: there are thumbnails to compare`, measured.thumbs.length > 0);
    for (const thumb of measured.thumbs) t.eq(`${width}: the tile's top and bottom`, measured.tile.join(), thumb.join());
    bots.forEach((bot) => bot.close());
  });
}

flow('layout short windows: chat keeps room to read, and a sideways bar stays on screen', { timeout: 60_000 }, async (t) => {
  const stacked = await t.person('host', { viewport: { width: 606, height: 679 } });
  const room = await startRoom(t, stacked, { url: video('Golden Hour').url });
  const box = await stacked.page.getByRole('textbox', { name: 'Message' }).boundingBox();
  t.check('606x679 alone: the message box is on screen', (box?.y ?? 9999) + (box?.height ?? 0) <= 679, `${box?.y}`);
  const guest = await t.person('guest');
  await joinRoom(guest, room.url);
  await t.see('the guest', stacked.page.getByText('guest').first());
  const log = await ui.chatLog(stacked.page).boundingBox();
  t.check('606x679 with a friend: chat has room for a few lines', (log?.height ?? 0) >= 60, `${log?.height}px`);

  const sideways = await t.person('side', { viewport: { width: 667, height: 375 }, phone: true });
  await startRoom(t, sideways, { url: video('Golden Hour').url });
  const spill = await sideways.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  t.check('667x375 bar stays on screen', spill <= 0, `${spill}px over`);
});
