// What a person who is not playing fair can send. The room must stay up for everyone else.
import { joinRoom, openTab, reenter, sendChat, slugOf, startRoom, ui } from '../lib/app.mjs';
import { bot } from '../lib/bots.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');

const room = async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const live = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, live.url);
  return { a, b, live };
};

const rawSocket = async (t, slug) => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '10.79.0.1' };
  const me = await fetch(`${t.base}/v1/me`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Eve' }) });
  const cookie = me.headers.getSetCookie().at(-1).split(';')[0];
  const ticket = await fetch(`${t.base}/v1/rooms/${slug}/ticket`, { method: 'POST', headers: { ...headers, cookie }, body: '{}' });
  const socket = new WebSocket(`${t.base.replace('http', 'ws')}/v1/ws?ticket=${(await ticket.json()).ticket}`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return socket;
};

const stillFine = async (t, a, b, words) => {
  await sendChat(b.page, words);
  await t.see(`${words} reaches Ana`, ui.chatLog(a.page).getByText(words));
};

flow('hostile: junk on a socket leaves the room standing', async (t) => {
  const { a, b, live } = await room(t);
  const junk = ['not json', '{', '[]', 'null', '{"t":5}', '{"t":"chat.send"}', '{"t":"chat.send","d":"text"}',
    '{"t":"queue.add","d":{"url":5}}', '{"t":"seek","d":{"pos":"never"}}', '{"t":"seek","d":{"pos":1e308}}',
    '{"t":"seek","d":{"pos":-5}}', '{"t":"queue.move","d":{"id":"nope","to":-1}}', '{"t":"nothing"}'];
  for (const message of junk) {
    const socket = await rawSocket(t, live.slug);
    socket.send(message);
    await t.sleep(60);
    socket.close();
  }
  await stillFine(t, a, b, 'still here');
  const time = (await a.sample())?.time;
  t.check('the player was not thrown anywhere', time >= 0 && time < 120, String(time));
});

flow('hostile: an oversized message is refused and nobody else notices', async (t) => {
  const { a, b, live } = await room(t);
  const socket = await rawSocket(t, live.slug);
  socket.send(JSON.stringify({ t: 'chat.send', d: { text: 'x'.repeat(200_000) } }));
  await t.sleep(300);
  await stillFine(t, a, b, 'after the flood');
  t.eq('nothing that long', await ui.chatLog(a.page).getByText('xxxxxxxxxxxxxxxx').count(), 0);
});

flow('hostile: NUL and control characters do not reach anyone or break saving', async (t) => {
  const { a, b, live } = await room(t);
  const eve = await bot(t.base, live.slug, 'Eve', '10.79.0.2');
  eve.say('nul\u0000byte');
  eve.say('bell\u0007and\u001b[31mred');
  eve.send('rename', { name: 'E\u0000v\u0007e' });
  await t.sleep(800);
  const lines = await ui.chatLog(a.page).innerText();
  t.check('no control characters on screen', !/[\u0000-\u0008\u000b-\u001f]/.test(lines), JSON.stringify(lines.slice(-80)));
  await stillFine(t, a, b, 'and still saving');
  await b.page.reload();
  await reenter(b.page);
  await t.see('history comes back', ui.chatLog(b.page).getByText('and still saving'));
  eve.close();
});

flow('hostile: tickets work once, for one room', async (t) => {
  const { live } = await room(t);
  const dial = (ticket) => new Promise((resolve) => {
    const socket = new WebSocket(`${t.base.replace('http', 'ws')}/v1/ws?ticket=${ticket}`);
    socket.onopen = () => { socket.close(); resolve('open'); };
    socket.onerror = () => resolve('refused');
  });
  t.eq('a made-up ticket', await dial('not-a-ticket'), 'refused');
  t.eq('no ticket', await dial(''), 'refused');
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '10.79.0.3' };
  const me = await fetch(`${t.base}/v1/me`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Eve' }) });
  const cookie = me.headers.getSetCookie().at(-1).split(';')[0];
  const made = await fetch(`${t.base}/v1/rooms/${live.slug}/ticket`, { method: 'POST', headers: { ...headers, cookie }, body: '{}' });
  const { ticket } = await made.json();
  t.eq('the real one', await dial(ticket), 'open');
  t.eq('the same one again', await dial(ticket), 'refused');
});

flow('hostile: names and messages are text, never markup', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const live = await startRoom(t, a, { url: golden.url });
  const trap = '<img src=x onerror=window.__pwned=1>';
  await joinRoom(b, live.url, { name: trap.slice(0, 32) });
  await sendChat(b.page, `${trap} <script>window.__pwned=1</script> javascript:window.__pwned=1`);
  await t.see('the words themselves', ui.chatLog(a.page).getByText('onerror=window.__pwned=1').first());
  t.eq('nothing ran', await a.page.evaluate(() => window.__pwned ?? null), null);
  t.eq('no image came of it', await ui.chatLog(a.page).locator('img[src="x"]').count(), 0);
  const links = await ui.chatLog(a.page).getByRole('link').evaluateAll((all) => all.map((link) => link.href));
  t.check('no script links', !links.some((href) => href.startsWith('javascript:')), links.join(' '));
});

flow('hostile: a link preview page escapes a nasty title and room name', async (t) => {
  const nasty = video('<script>');
  const a = await t.person('Ana');
  const live = await startRoom(t, a, { url: nasty.url });
  const html = await (await fetch(`${t.base}/r/${live.slug}`)).text();
  t.check('no raw markup in the head', !/<script>alert/.test(html));
  t.check('it is there, escaped', /&lt;script&gt;alert|&#34;title/.test(html), html.match(/og:description[^>]*/)?.[0] ?? 'no tag');
});

flow('hostile: paths outside the site stay outside', async (t) => {
  for (const path of ['/../../../etc/passwd', '/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/.env', '/.git/config', '/....//....//etc/passwd', '/assets/../../server.log']) {
    const answer = await fetch(`${t.base}${path}`, { redirect: 'follow' });
    const body = await answer.text();
    t.check(`${path} gives nothing away`, !/root:|\[core\]|DATABASE_URL/.test(body), `${answer.status} ${body.slice(0, 60)}`);
  }
});

flow('hostile: a guest cannot do a host\'s job over the socket', async (t) => {
  const a = await t.person('Ana');
  const live = await startRoom(t, a, { url: golden.url });
  await openTab(a.page, 'People');
  await ui.hostSwitch(a.page).click();
  await t.until('locked', async () => (await ui.hostSwitch(a.page).getAttribute('aria-checked')) === 'true');
  const eve = await bot(t.base, slugOf(a.page), 'Eve', '10.79.0.4');
  eve.send('settings', { hostOnly: false });
  eve.send('skip', {});
  eve.send('pause', { pos: 1 });
  await t.sleep(800);
  t.eq('the lock holds', await ui.hostSwitch(a.page).getAttribute('aria-checked'), 'true');
  t.eq('the video plays on', (await a.sample())?.state, 'playing');
  await t.expect('still on it', ui.bar(a.page).getByRole('heading', { name: golden.title }));
  eve.close();
  t.check('a room to speak of', Boolean(live.slug));
});
