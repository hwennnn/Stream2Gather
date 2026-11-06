import { addByMessage, joinRoom, openTab, player, react, reenter, sendChat, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const train = video('Night Train');

const locked = async (t) => {
  const host = await t.person('Hana');
  const guest = await t.person('Gus');
  const room = await startRoom(t, host, { url: golden.url });
  await joinRoom(guest, room.url);
  await addByMessage(t, host.page, [train.url]);
  await openTab(host.page, 'People');
  await ui.hostSwitch(host.page).click();
  await t.see('the switch is on', host.page.getByRole('switch', { checked: true }));
  return { host, guest, room };
};

flow('host lock: only the host sees the switch, and turning it on reaches everyone', async (t) => {
  const { host, guest } = await locked(t);
  await openTab(guest.page, 'People');
  t.eq('the guest has no switch', await ui.hostSwitch(guest.page).count(), 0);
  await t.see('the guest is told', ui.rail(guest.page).getByText(/host controls playback and the queue/i));
  await t.see('the chip', guest.page.getByText('Host controls', { exact: true }));
  await openTab(guest.page, 'Chat');
  await t.see('the chat says who', ui.chatLog(guest.page).getByText('Hana turned on host controls'));
  await openTab(host.page, 'Chat');
  await t.see('for the host too', ui.chatLog(host.page).getByText('Hana turned on host controls'));
});

flow('host lock: a guest loses the controls but keeps the chat', async (t) => {
  const { guest, host } = await locked(t);
  t.eq('no Skip', await ui.bar(guest.page).getByRole('button', { name: /^(skip|finish)$/i }).count(), 0);
  await openTab(guest.page, 'Queue');
  await t.see('the queue says why', ui.rail(guest.page).getByText(/only the host can change the queue/i));
  t.eq('no add box', await ui.addBox(guest.page).count(), 0);
  await ui.upNext(guest.page).getByRole('listitem').filter({ hasText: train.title }).hover();
  t.eq('no row actions', await ui.upNext(guest.page).getByRole('button').count(), 0);
  await openTab(guest.page, 'Chat');
  t.check('the strip is not playable', await guest.page.getByRole('region', { name: 'Up next in the queue' }).getByRole('button').first().isDisabled());
  await sendChat(guest.page, 'can still talk');
  await openTab(host.page, 'Chat');
  await t.see('chat works', ui.chatLog(host.page).getByText('can still talk'));
  await react(guest.page, '🔥');
  await t.see('reactions work', ui.rail(host.page).getByText('🔥'));
});

flow('host lock: a guest pausing or seeking is put back, with a reason', async (t) => {
  const { guest, host } = await locked(t);
  await t.until('they play', async () => (await guest.sample())?.time > 1);
  await player(guest.page).pause();
  await t.expect('the reason', guest.page.getByText(/host controls this room/i));
  await t.until('the guest is playing again', async () => (await guest.sample())?.state === 'playing', 8000);
  t.eq('the host never stopped', (await host.sample())?.state, 'playing');
  await t.sleep(2000);
  await player(guest.page).seek(200);
  await t.until('the guest is back with the room', async () => {
    const now = await guest.sample();
    return now && Math.abs(now.time - now.expected) < 1;
  }, 8000);
  t.check('the room did not move', (await host.sample()).time < 60);
});

flow('host lock: the server refuses what the buttons hide', async (t) => {
  const { guest, host } = await locked(t);
  const refused = (type, data) => guest.page.evaluate(([kind, body]) => new Promise((resolve) => {
    const socket = window.__net.sockets.at(-1);
    const id = `probe-${Math.random()}`;
    const listen = (event) => {
      const { t: name, d } = JSON.parse(event.data);
      if (name === 'error' && d.re === id) resolve(d.code);
      if (name === 'ack' && d.id === id) resolve('accepted');
    };
    socket.addEventListener('message', listen);
    window.__net.send(kind, body, id);
    setTimeout(() => resolve('no answer'), 2500);
  }), [type, data]);
  const item = await host.page.evaluate(() => window.__s2g.sample());
  void item;
  t.eq('queue.add', await refused('queue.add', { url: video('Rainy Window').url, mode: 'end' }), 'forbidden');
  t.eq('settings', await refused('settings', { settings: { controlMode: 'everyone', queueMode: 'everyone' } }), 'forbidden');
  t.eq('skip', await refused('skip', {}), 'forbidden');
});

flow('host lock: turning it off gives the controls back', async (t) => {
  const { guest, host } = await locked(t);
  await ui.hostSwitch(host.page).click();
  await t.see('Skip returns', ui.bar(guest.page).getByRole('button', { name: 'Skip' }));
  await t.gone('the chip', guest.page.getByText('Host controls', { exact: true }));
  await t.see('the chat says it', ui.chatLog(guest.page).getByText('Hana turned off host controls'));
});

flow('host lock: survives a host reload', async (t) => {
  const { guest, host } = await locked(t);
  await host.page.reload();
  await reenter(host.page);
  await openTab(host.page, 'People');
  await t.see('still on', host.page.getByRole('switch', { checked: true }));
  await t.sleep(1000);
  t.check('the guest was not given the room', !(await guest.page.getByRole('button', { name: 'Skip' }).isVisible()));
});

flow('host lock: a late joiner arrives locked out', async (t) => {
  const { room } = await locked(t);
  const late = await t.person('Late');
  await joinRoom(late, room.url);
  await t.see('the chip', late.page.getByText('Host controls', { exact: true }));
  t.eq('no Skip', await ui.bar(late.page).getByRole('button', { name: 'Skip' }).count(), 0);
});

flow('handover: a locked room opens up when the host goes, and locks when they return', { timeout: 120_000 }, async (t) => {
  const { host, guest, room } = await locked(t);
  await host.page.goto('about:blank');
  await t.see('the room opens up', guest.page.getByText(/Hana left, so anyone can control playback/), 55_000);
  await t.see('Skip for the guest', ui.bar(guest.page).getByRole('button', { name: 'Skip' }));
  await t.gone('the chip', guest.page.getByText('Host controls', { exact: true }));
  await host.page.goto(room.url);
  await reenter(host.page);
  await t.see('the lock returns', guest.page.getByText(/Hana is back, so they control playback again/), 15_000);
  await t.gone('Skip for the guest', ui.bar(guest.page).getByRole('button', { name: 'Skip' }));
});

flow('handover: an open room carries on untouched without its host', async (t) => {
  const host = await t.person('Hana');
  const guest = await t.person('Gus');
  const room = await startRoom(t, host, { url: golden.url });
  await joinRoom(guest, room.url);
  await host.page.goto('about:blank');
  await t.see('the host goes', ui.chatLog(guest.page).getByText('Hana left'));
  await t.until('the guest keeps watching', async () => (await guest.sample())?.state === 'playing');
  await t.see('and keeps the controls', ui.bar(guest.page).getByRole('button', { name: /finish|skip/i }));
});
