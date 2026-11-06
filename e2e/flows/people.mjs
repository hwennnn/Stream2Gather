import { joinRoom, openTab, reenter, sendChat, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');
const person = (page, name) => ui.rail(page).getByRole('listitem').filter({ hasText: name });

flow('invite: the button copies the room link and a friend gets in with it', async (t) => {
  const host = await t.person('host');
  const friend = await t.person('friend');
  const room = await startRoom(t, host, { url: golden.url });
  await host.page.evaluate(() => navigator.clipboard.writeText('stale'));
  await ui.invite(host.page).click();
  await t.see('the button says so', host.page.getByRole('button', { name: 'Copied' }));
  const copied = await host.page.evaluate(() => navigator.clipboard.readText());
  t.eq('the room link', copied, room.url);
  await joinRoom(friend, copied);
  await t.see('the friend in the room', ui.bar(friend.page).getByRole('heading', { name: golden.title }));
});

flow('invite: while alone the rail offers the link, and it goes once someone comes', async (t) => {
  const host = await t.person('host');
  const friend = await t.person('friend');
  const room = await startRoom(t, host, { url: golden.url });
  const shown = room.url.replace(/^https?:\/\//, '');
  const sheet = host.page.getByRole('region', { name: 'Invite' });
  await t.see('the card', sheet.getByText(shown));
  await t.see('saying what it is', sheet.getByText('What friends will see'));
  await sheet.getByRole('button', { name: /copy link/i }).click();
  t.eq('copied', await host.page.evaluate(() => navigator.clipboard.readText()), room.url);
  await joinRoom(friend, room.url);
  await t.gone('the card', sheet.getByText(shown));
});

flow('invite: when the browser refuses the clipboard, the link is still shown', async (t) => {
  const host = await t.person('host');
  const room = await startRoom(t, host);
  await host.page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
  });
  await ui.invite(host.page).click();
  await t.see('the link to copy by hand', host.page.getByText(room.url.replace(/^https?:\/\//, '')));
  t.eq('no claim it was copied', await host.page.getByRole('button', { name: 'Copied' }).count(), 0);
});

flow('invite: alone in an empty room, Invite answers', async (t) => {
  const host = await t.person('host');
  const room = await startRoom(t, host);
  await ui.invite(host.page).click();
  await t.see('the button says so', host.page.getByRole('button', { name: 'Copied' }));
  t.eq('the room link', await host.page.evaluate(() => navigator.clipboard.readText()), room.url);
});

flow('invite: alone after chatting, Invite answers', async (t) => {
  const host = await t.person('host');
  const room = await startRoom(t, host, { url: golden.url });
  await sendChat(host.page, 'anyone there');
  await ui.invite(host.page).click();
  await t.see('the link', host.page.getByText(room.url.replace(/^https?:\/\//, '')));
  await t.see('the button says so', host.page.getByRole('button', { name: 'Copied' }));
});

flow('people: a second and third person arrive, and everyone sees everyone', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const c = await t.person('Cal');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.see('Ana hears of Ben', ui.arrival(a.page, 'Ben'));
  await joinRoom(c, room.url);
  await t.see('Ana hears of Cal', ui.arrival(a.page, 'Cal'));
  await t.see('Ben hears of Cal', ui.arrival(b.page, 'Cal'));
  t.check('Cal is not told of Cal', !(await ui.arrival(c.page, 'Cal').isVisible()));

  for (const client of [a, b, c]) {
    await openTab(client.page, 'People');
    await t.see(`${client.name} sees the count`, ui.tab(client.page, 'People').getByText('3'));
    for (const name of ['Ana', 'Ben', 'Cal']) await t.expect(`${client.name} sees ${name}`, person(client.page, name));
    await t.expect(`${client.name} sees who they are`, person(client.page, client.name).getByText('(you)'));
    await t.expect(`${client.name} sees the host`, person(client.page, 'Ana').getByText('Host'));
  }
  await t.see('the seats show everyone', a.page.getByRole('list', { name: 'In the room' }).filter({ hasText: 'Ben' }).filter({ hasText: 'Cal' }));
});

flow('people: someone leaving is noticed, and the last one left is alone again', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const c = await t.person('Cal');
  const room = await startRoom(t, a);
  await joinRoom(b, room.url);
  await joinRoom(c, room.url);
  await c.page.close();
  // A dropped socket might be a reload, so the room waits ten seconds before saying so.
  await t.see('Cal leaving noticed', ui.chatLog(a.page).getByText('Cal left'), 45_000);
  await t.see('by both', ui.chatLog(b.page).getByText('Cal left'));
  await openTab(a.page, 'People');
  await t.gone('Cal in the list', person(a.page, 'Cal'));
  await b.page.goto('about:blank');
  await t.gone('Ben in the list', person(a.page, 'Ben'));
  await openTab(a.page, 'Chat');
  await t.see('the invite again', ui.invite(a.page));
});

flow('people: a reload is not a goodbye', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await t.see('Ben arrives', ui.arrival(a.page, 'Ben'));
  await b.page.reload();
  await reenter(b.page);
  await t.see('the video back', ui.bar(b.page).getByRole('heading', { name: golden.title }));
  await t.until('it plays again', async () => (await b.sample())?.state === 'playing');
  await t.sleep(1000);
  t.check('nobody was told Ben left', !(await ui.chatLog(a.page).getByText('Ben left').isVisible()));
});

flow('people: the host reloading stays host and keeps the room', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await a.page.reload();
  await reenter(a.page);
  await openTab(a.page, 'People');
  await t.see('still host', person(a.page, 'Ana').getByText('Host'));
  await t.see('still has the switch', ui.hostSwitch(a.page));
  t.eq('same room', a.page.url(), room.url);
});

flow('two tabs: one person in two tabs is one person', async (t) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a);
  await joinRoom(b, room.url);
  const second = await b.open();
  await joinRoom(b, room.url, { page: second });
  await openTab(a.page, 'People');
  await t.sleep(500);
  t.eq('still two people', await ui.rail(a.page).getByRole('listitem').count(), 2);
  await openTab(a.page, 'Chat');
  t.eq('Ben joined once', await ui.arrival(a.page, 'Ben').count(), 1);
  await sendChat(a.page, 'to both tabs');
  await t.see('first tab', ui.chatLog(b.page).getByText('to both tabs'));
  await t.see('second tab', ui.chatLog(second).getByText('to both tabs'));
  await second.close();
  await t.sleep(800);
  t.check('closing one tab is not leaving', !(await ui.chatLog(a.page).getByText('Ben left').isVisible()));
  await sendChat(b.page, 'still here');
  await t.see('the other tab still talks', ui.chatLog(a.page).getByText('still here'));
});

flow('two tabs: a rename reaches the other tab', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a);
  const second = await a.open();
  await joinRoom(a, room.url, { page: second, name: 'Ana' });
  await openTab(a.page, 'People');
  await openTab(second, 'People');
  await person(a.page, 'Ana').getByRole('button', { name: 'Rename' }).click();
  await a.page.getByRole('textbox', { name: 'Your name' }).fill('Annie');
  await a.page.getByRole('textbox', { name: 'Your name' }).press('Enter');
  await t.see('this tab', person(a.page, 'Annie'));
  await t.see('the other tab', person(second, 'Annie'));
});

flow('two tabs: too many tabs gets a clear no', async (t) => {
  const a = await t.person('Ana');
  const room = await startRoom(t, a);
  for (let i = 0; i < 9; i += 1) {
    const page = await a.open();
    await page.goto(room.url);
    await ui.join(page).click();
    await ui.rail(page).waitFor({ state: 'visible', timeout: 10_000 });
  }
  const eleventh = await a.open();
  await eleventh.goto(room.url);
  await ui.join(eleventh).click();
  await t.see('why not', eleventh.getByText(/too many tabs/i));
  await t.see('a way forward', eleventh.getByRole('button', { name: /new room/i }));
});
