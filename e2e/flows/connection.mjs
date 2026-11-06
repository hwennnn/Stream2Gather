import { addByMessage, joinRoom, openTab, player, reenter, sample, sendChat, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');

const pair = async (t, url = golden.url) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url });
  await joinRoom(b, room.url);
  return { a, b, room };
};

const lostBar = (page) => page.getByRole('status').getByText(/reconnecting|still trying/i);

flow('reconnect: a dropped socket says so, then says it is back', async (t) => {
  const { a, b } = await pair(t);
  await t.until('playing', async () => (await b.sample())?.state === 'playing');
  // Offline, because a socket that just closes is often back before anyone can see it.
  await b.offline();
  await t.see('the bar', lostBar(b.page), 2000);
  await b.online();
  await t.gone('the bar', lostBar(b.page), 8000);
  await t.see('the welcome back', b.page.getByText(/you.re back/i));
  await t.until('still in step', async () => {
    const [x, y] = await Promise.all([a.sample(), b.sample()]);
    return y && Math.abs((x.time - x.expected) - (y.time - y.expected)) < 0.5;
  }, 8000);
  await t.sleep(500);
  t.check('nobody saw Ben leave', !(await ui.chatLog(a.page).getByText('Ben left').isVisible()));
});

flow('offline: everything that needs the room says so while it is gone', async (t) => {
  const { a, b } = await pair(t);
  await addByMessage(t, a.page, [train.url]);
  await openTab(b.page, 'Queue');
  await t.see('queued', ui.upNext(b.page).getByText(train.title));
  await b.offline();
  await t.see('the bar', lostBar(b.page), 2000);
    t.check('Skip is off', await ui.skip(b.page).isDisabled());
  await ui.upNext(b.page).getByRole('listitem').filter({ hasText: train.title }).hover();
  t.check('Remove is off', await ui.upNext(b.page).getByRole('button', { name: /^Remove/ }).isDisabled());
  await openTab(b.page, 'Chat');
  t.check('chat is off', await b.page.getByRole('button', { name: 'Send' }).isDisabled());
  await t.see('and says why', b.page.getByPlaceholder('Reconnecting…'));
  await b.online();
  await t.gone('the bar', lostBar(b.page), 10_000);
  await t.see('chat is back', b.page.getByPlaceholder('Message', { exact: true }));
});

flow('offline: coming back catches up with what the room did', { timeout: 60_000 }, async (t) => {
  const { a, b } = await pair(t);
  await t.until('playing', async () => (await b.sample())?.time > 1);
  await b.offline();
  await t.sleep(500);
  await addByMessage(t, a.page, [train.url]);
  await ui.skip(a.page).click();
  await sendChat(a.page, 'said while Ben was away');
  await t.see('Ana moved on', ui.bar(a.page).getByRole('heading', { name: train.title }));
  await b.online();
  await t.see('Ben is on the new video', ui.bar(b.page).getByRole('heading', { name: train.title }), 12_000);
  await t.see('Ben gets the chat', ui.chatLog(b.page).getByText('said while Ben was away'));
  await t.until('Ben plays', async () => (await b.sample())?.state === 'playing', 8000);
});

flow('offline: a draft survives the drop, and sends after', async (t) => {
  const { a, b } = await pair(t);
  await ui.chatBox(b.page).fill('typed through it');
  await b.offline();
  await t.see('the bar', lostBar(b.page), 2000);
  t.eq('the draft stays', await ui.chatBox(b.page).inputValue(), 'typed through it');
  await b.online();
  await t.gone('the bar', lostBar(b.page), 10_000);
  await ui.chatBox(b.page).press('Enter');
  await t.see('it sends', ui.chatLog(a.page).getByText('typed through it'));
});

flow('offline: a network that goes silent without closing is noticed', { timeout: 40_000 }, async (t) => {
  const { b } = await pair(t);
  await b.page.evaluate(() => { window.__net.deaf = true; });
  await t.see('the bar, within seconds', lostBar(b.page), 13_000);
  // It went deaf, so the socket it opened since has missed its welcome. A real one can't.
  await b.page.evaluate(() => {
    window.__net.deaf = false;
    window.__net.cut();
  });
  await t.gone('the bar', lostBar(b.page), 10_000);
});

flow('offline: a long drop keeps trying, offers a retry and it works', { timeout: 70_000 }, async (t) => {
  const { a, b } = await pair(t);
  await b.offline();
  await t.see('the long message', b.page.getByText(/still trying/i), 40_000);
  const retry = b.page.getByRole('button', { name: /try again/i });
  await t.see('the button', retry);
  await b.online();
  await retry.click();
  await t.gone('the bar', lostBar(b.page), 8000);
  await sendChat(b.page, 'made it');
  await t.see('Ana hears', ui.chatLog(a.page).getByText('made it'));
});

flow('offline: a room link opened with no network can be retried', async (t) => {
  const host = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, host);
  await b.page.goto(t.base);
  await b.page.route('**/v1/rooms/**', (route) => route.abort());
  await b.page.goto(room.url);
  await t.see('the dead end', b.page.getByRole('heading', { name: /can.t reach this room/i }));
  await b.page.unroute('**/v1/rooms/**');
  await b.page.getByRole('button', { name: /try again/i }).click();
  await t.see('the gate', ui.join(b.page));
});

flow('server restart: everyone comes back to the same video and chat', { serial: true, timeout: 60_000 }, async (t) => {
  const { a, b } = await pair(t, sample(t.base));
  await t.until('both play', async () => (await Promise.all([a.sample(), b.sample()])).every((s) => s?.time > 2), 10_000);
  await t.sleep(1500);
  await sendChat(a.page, 'before the restart');
  await t.see('sent', ui.chatLog(b.page).getByText('before the restart'));
  await player(a.page).seek(60);
  await t.until('moved', async () => (await b.sample())?.time > 59, 8000);
  await t.stack.stop();
  await t.see('Ana sees the bar', lostBar(a.page), 12_000);
  await t.stack.start();
  await t.gone('the bar for Ana', lostBar(a.page), 15_000);
  await t.gone('the bar for Ben', lostBar(b.page), 15_000);
  await t.until('both still near where they were', async () => {
    const [x, y] = await Promise.all([a.sample(), b.sample()]);
    return x?.state === 'playing' && y?.state === 'playing' && x.time > 59 && y.time > 59;
  }, 12_000);
  await sendChat(b.page, 'after the restart');
  await t.see('chat works', ui.chatLog(a.page).getByText('after the restart'));
  t.eq('old chat is not doubled', await ui.chatLog(a.page).getByText('before the restart').count(), 1);
});

flow('server crash: nobody is left as a ghost', { serial: true, timeout: 90_000 }, async (t) => {
  const { a, b, room } = await pair(t, sample(t.base));
  await t.stack.stop('SIGKILL');
  await t.stack.start();
  await t.gone('the bar for Ana', lostBar(a.page), 20_000);
  await t.gone('the bar for Ben', lostBar(b.page), 20_000);
  await b.page.goto('about:blank');
  await openTab(a.page, 'People');
  await t.until('Ben really leaves', async () => (await ui.rail(a.page).getByRole('listitem').count()) === 1, 45_000);
  const preview = await fetch(`${t.base}/v1/rooms/${room.slug}`).then((r) => r.json());
  t.eq('the gate counts the same', preview.members.length, 1);
});

flow('redis lost: the room comes back from its last save', { serial: true, timeout: 60_000 }, async (t) => {
  const { a, b, room } = await pair(t, golden.url);
  await addByMessage(t, a.page, [train.url]);
  await t.sleep(6500); // The room saves every five seconds.
  await t.stack.redis('FLUSHALL');
  await sendChat(a.page, 'still here after redis');
  await t.see('chat still works', ui.chatLog(b.page).getByText('still here after redis'), 10_000);
  await t.see('the video stays', ui.bar(a.page).getByRole('heading', { name: golden.title }));
  await openTab(a.page, 'Queue');
  await t.see('the queue stays', ui.upNext(a.page).getByText(train.title), 12_000);
  const c = await t.person('Cal');
  await joinRoom(c, room.url);
  await t.see('a newcomer gets the video', ui.bar(c.page).getByRole('heading', { name: golden.title }));
});

flow('reload: while offline the browser error is its own, and the room returns after', async (t) => {
  const { b, room } = await pair(t);
  await b.offline();
  await b.page.reload().catch(() => {});
  await b.online();
  await b.page.goto(room.url);
  await reenter(b.page);
  await t.see('back in', ui.bar(b.page).getByRole('heading', { name: golden.title }));
});
